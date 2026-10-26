#!/usr/bin/env python3
"""Entraîne les deux réseaux de Roi des Flibustiers sur les données d'auto-jeu.

    python tools/nn/entrainer.py --donnees tools/nn/donnees --sortie tools/nn/modeles

DEUX PROBLÈMES DISTINCTS, ET C'EST VOULU :

1. LE PARI (`pari`). « Combien de plis cette main va-t-elle prendre ? » L'étiquette est objective et
   gratuite — la manche jouée la donne. C'est le problème le mieux posé des deux, et celui qui décide le
   plus de points : au Roi des Flibustiers, un pari raté coûte plus qu'une carte mal jouée.

2. LE COUP (`coup`). « Quelle carte poserait un bot Monte-Carlo qui a réfléchi 400 simulations ? » C'est de
   l'IMITATION : le réseau ne sera pas meilleur que son maître, il sera aussi bon pour un millième du coût.
   C'est exactement le défaut qu'on a mesuré sur le serveur — les bots `normal` figeaient toutes les tables
   en calculant sur la boucle d'événements. Un réseau répond en une multiplication de matrices.

Le masque des coups légaux est appliqué AVANT la perte : sans lui, le réseau apprend à proposer des cartes
qu'il n'a pas en main et sa justesse mesurée est un mensonge.
"""

import argparse
import json
import math
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


def dossiers(valeur) -> list:
    """Les dossiers de donnees, qu'on en passe un ou plusieurs."""
    return [Path(v) for v in ([valeur] if isinstance(valeur, str) else valeur)]


def rang(chemin: Path) -> int:
    """Le numéro de part d'un fichier, pour trier `coup.10.bin` APRÈS `coup.2.bin`.

    Le tri alphabétique mettrait 10 avant 2. Les traits, les étiquettes et les masques seraient alors
    recollés dans trois ordres différents : chaque ligne recevrait l'étiquette d'une autre partie, le
    réseau apprendrait du bruit, et RIEN ne le signalerait — la perte descendrait quand même un peu.
    """
    for bout in chemin.name.split("."):
        if bout.isdigit():
            return int(bout)
    return -1


def lire_parts(liste, base: str, largeur: int, dtype=np.float32):
    """Recolle les tranches écrites par les N processus du générateur (`pari.0.bin`, `pari.1.bin`, …)."""
    # Le générateur écrit `coup.bin` en solo, `coup.7.bin` en parts — et le masque du même lot s'appelle
    # `coup.7.masque.bin`, donc le NUMÉRO est au milieu. Un `coup.masque.*.bin` ne trouve rien : c'est ce
    # qui a fait échouer la première nuit d'entraînement, APRÈS cinq heures de génération et une fois le
    # réseau du pari déjà appris. D'où les deux motifs explicites, et le refus bruyant s'il ne reste rien.
    morceaux = []
    for dossier in liste:
        if base.endswith(".masque"):
            prefixe = base[: -len(".masque")]
            m = sorted(dossier.glob(f"{prefixe}.*.masque.bin"), key=rang) + sorted(dossier.glob(f"{prefixe}.masque.bin"))
        else:
            m = sorted(dossier.glob(f"{base}.*.bin"), key=rang) + sorted(dossier.glob(f"{base}.bin"))
            m = [f for f in m if not f.name.endswith(".y.bin") and ".masque" not in f.name]
        morceaux += list(dict.fromkeys(m))
    if not morceaux:
        raise SystemExit(f"aucun fichier {base}*.bin dans {[str(d) for d in liste]}")
    tables = [np.fromfile(m, dtype=dtype).reshape(-1, largeur) for m in morceaux]
    return np.concatenate(tables, axis=0) if len(tables) > 1 else tables[0]


def lire_etiquettes(liste, base: str, dtype):
    morceaux = []
    for dossier in liste:
        morceaux += sorted(dossier.glob(f"{base}.*.y.bin"), key=rang) or sorted(dossier.glob(f"{base}.y.bin"))
    if not morceaux:
        raise SystemExit(f"aucune étiquette {base}*.y.bin dans {[str(d) for d in liste]}")
    tables = [np.fromfile(m, dtype=dtype) for m in morceaux]
    return np.concatenate(tables) if len(tables) > 1 else tables[0]


class Reseau(nn.Module):
    """Un perceptron à trois couches, résiduel.

    Pourquoi si simple : l'entrée est déjà une description structurée (une main encodée en multi-chaud,
    pas une image). Il n'y a ni voisinage spatial à convoluer, ni séquence à mémoriser — les données sont
    un vecteur, et un MLP large les traite très bien. Commencer par le modèle le plus simple qui puisse
    marcher, c'est aussi ce qui permet de savoir, demain, si un modèle plus gros apporte vraiment quelque
    chose : sans cette référence, on ne compare rien.
    """

    def __init__(self, entree: int, sortie: int, largeur: int = 512, couches: int = 3, p_abandon: float = 0.1):
        super().__init__()
        self.entree = nn.Sequential(nn.Linear(entree, largeur), nn.LayerNorm(largeur), nn.GELU())
        self.blocs = nn.ModuleList(
            nn.Sequential(nn.Linear(largeur, largeur), nn.LayerNorm(largeur), nn.GELU(), nn.Dropout(p_abandon))
            for _ in range(couches)
        )
        self.sortie = nn.Linear(largeur, sortie)

    def forward(self, x):
        h = self.entree(x)
        for b in self.blocs:
            h = h + b(h)  # résiduel : le gradient traverse même quand une couche n'apprend rien
        return self.sortie(h)


def lots(n: int, taille: int, melange: bool, generateur: torch.Generator):
    ordre = torch.randperm(n, generator=generateur) if melange else torch.arange(n)
    for i in range(0, n, taille):
        yield ordre[i : i + taille]


def entrainer_pari(donnees: Path, sortie: Path, meta: dict, args, appareil):
    X = lire_parts(donnees, "pari", meta["taillePari"])
    y = lire_etiquettes(donnees, "pari", np.uint8)
    n = min(len(X), len(y))
    X, y = X[:n], y[:n]
    print(f"[pari] {n:,} annonces · {meta['taillePari']} traits", flush=True)

    # 11 classes (0 à 10 plis) : la classification bat la régression ici, parce que la distribution est
    # bimodale (on parie souvent 0 ou 1) et qu'une moyenne à 0,7 pli n'est pas une annonce jouable.
    classes = 11
    Xt = torch.from_numpy(X)
    yt = torch.from_numpy(y.astype(np.int64)).clamp_(0, classes - 1)

    coupe = int(n * 0.95)
    modele = Reseau(meta["taillePari"], classes, args.largeur, args.couches).to(appareil)
    opt = torch.optim.AdamW(modele.parameters(), lr=args.lr, weight_decay=1e-2)
    pas_total = max(1, math.ceil(coupe / args.lot) * args.epoques)
    plan = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=pas_total)
    g = torch.Generator().manual_seed(1)

    meilleur = 0.0
    for epoque in range(args.epoques):
        modele.train()
        perte_cum, vus = 0.0, 0
        for idx in lots(coupe, args.lot, True, g):
            xb, yb = Xt[idx].to(appareil, non_blocking=True), yt[idx].to(appareil, non_blocking=True)
            perte = F.cross_entropy(modele(xb), yb, label_smoothing=0.02)
            opt.zero_grad(set_to_none=True)
            perte.backward()
            nn.utils.clip_grad_norm_(modele.parameters(), 1.0)
            opt.step()
            plan.step()
            perte_cum += perte.item() * len(idx)
            vus += len(idx)

        modele.eval()
        justes = ecart = total = 0
        with torch.no_grad():
            for idx in lots(n - coupe, 8192, False, g):
                j = idx + coupe
                xb, yb = Xt[j].to(appareil), yt[j].to(appareil)
                pred = modele(xb).argmax(1)
                justes += (pred == yb).sum().item()
                ecart += (pred - yb).abs().sum().item()
                total += len(j)
        exact = justes / max(1, total)
        print(f"[pari] époque {epoque + 1}/{args.epoques} · perte {perte_cum / max(1, vus):.4f} · exact {exact:.3f} · écart moyen {ecart / max(1, total):.3f}", flush=True)
        if exact > meilleur:
            meilleur = exact
            torch.save({"etat": modele.state_dict(), "entree": meta["taillePari"], "classes": classes,
                        "largeur": args.largeur, "couches": args.couches,
                        "versionEncodage": meta["versionEncodage"], "exact": exact}, sortie / "pari.pt")
    print(f"[pari] meilleur : {meilleur:.3f} exact — {sortie / 'pari.pt'}", flush=True)
    return meilleur


def entrainer_coup(donnees: Path, sortie: Path, meta: dict, args, appareil):
    X = lire_parts(donnees, "coup", meta["tailleCoup"])
    y = lire_etiquettes(donnees, "coup", np.uint16)
    M = lire_parts(donnees, "coup.masque", meta["tailleVocabulaire"])
    n = min(len(X), len(y), len(M))
    X, y, M = X[:n], y[:n], M[:n]
    print(f"[coup] {n:,} coups · {meta['tailleCoup']} traits · {meta['tailleVocabulaire']} cartes", flush=True)

    Xt = torch.from_numpy(X)
    yt = torch.from_numpy(y.astype(np.int64))
    Mt = torch.from_numpy(M)
    coupe = int(n * 0.98)
    modele = Reseau(meta["tailleCoup"], meta["tailleVocabulaire"], args.largeur, args.couches).to(appareil)
    opt = torch.optim.AdamW(modele.parameters(), lr=args.lr, weight_decay=1e-2)
    pas_total = max(1, math.ceil(coupe / args.lot) * args.epoques)
    plan = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=pas_total)
    g = torch.Generator().manual_seed(2)
    INTERDIT = -1e9

    meilleur = 0.0
    for epoque in range(args.epoques):
        modele.train()
        perte_cum, vus = 0.0, 0
        for idx in lots(coupe, args.lot, True, g):
            xb = Xt[idx].to(appareil, non_blocking=True)
            yb = yt[idx].to(appareil, non_blocking=True)
            mb = Mt[idx].to(appareil, non_blocking=True)
            # Le masque AVANT la perte : une carte qu'on n'a pas en main ne doit jamais recevoir de gradient.
            logits = modele(xb).masked_fill(mb < 0.5, INTERDIT)
            perte = F.cross_entropy(logits, yb)
            opt.zero_grad(set_to_none=True)
            perte.backward()
            nn.utils.clip_grad_norm_(modele.parameters(), 1.0)
            opt.step()
            plan.step()
            perte_cum += perte.item() * len(idx)
            vus += len(idx)

        modele.eval()
        justes = dans3 = total = 0
        with torch.no_grad():
            for idx in lots(n - coupe, 8192, False, g):
                j = idx + coupe
                logits = modele(Xt[j].to(appareil)).masked_fill(Mt[j].to(appareil) < 0.5, INTERDIT)
                yb = yt[j].to(appareil)
                justes += (logits.argmax(1) == yb).sum().item()
                k = min(3, logits.shape[1])
                dans3 += (logits.topk(k, dim=1).indices == yb.unsqueeze(1)).any(1).sum().item()
                total += len(j)
        exact = justes / max(1, total)
        print(f"[coup] époque {epoque + 1}/{args.epoques} · perte {perte_cum / max(1, vus):.4f} · même carte que le maître {exact:.3f} · dans son top-3 {dans3 / max(1, total):.3f}", flush=True)
        if exact > meilleur:
            meilleur = exact
            torch.save({"etat": modele.state_dict(), "entree": meta["tailleCoup"], "classes": meta["tailleVocabulaire"],
                        "largeur": args.largeur, "couches": args.couches,
                        "versionEncodage": meta["versionEncodage"], "exact": exact}, sortie / "coup.pt")
    print(f"[coup] meilleur : {meilleur:.3f} — {sortie / 'coup.pt'}", flush=True)
    return meilleur


def main():
    p = argparse.ArgumentParser()
    # PLUSIEURS DOSSIERS, et c'est une lecon payee cher : les fichiers d'un tirage s'appellent `coup.0.bin`,
    # `coup.1.bin`… quel que soit le tirage. Recopier un tirage par-dessus un autre pour les « fusionner »
    # ECRASE le premier — 3 h 30 de generation perdues le 2026-09-11. On ne fusionne plus : on lit les
    # dossiers cote a cote, chacun garde ses noms.
    p.add_argument("--donnees", default="tools/nn/donnees", nargs="+")
    p.add_argument("--sortie", default="tools/nn/modeles")
    p.add_argument("--epoques", type=int, default=12)
    p.add_argument("--lot", type=int, default=4096)
    p.add_argument("--lr", type=float, default=3e-3)
    p.add_argument("--largeur", type=int, default=512)
    p.add_argument("--couches", type=int, default=3)
    p.add_argument("--quoi", default="tout", choices=["tout", "pari", "coup"])
    args = p.parse_args()

    donnees, sortie = dossiers(args.donnees), Path(args.sortie)
    sortie.mkdir(parents=True, exist_ok=True)
    metas = [m for d in donnees for m in sorted(d.glob("meta*.json"))]
    if not metas:
        raise SystemExit(f"aucun meta*.json dans {[str(d) for d in donnees]} — lance d'abord le générateur")
    meta = json.loads(metas[0].read_text(encoding="utf-8"))
    print(f"dossiers : {', '.join(str(d) for d in donnees)}", flush=True)

    appareil = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"appareil : {appareil} · {torch.cuda.get_device_name(0) if appareil == 'cuda' else ''}", flush=True)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True

    debut = time.time()
    resultats = {}
    if args.quoi in ("tout", "pari"):
        resultats["pari"] = entrainer_pari(donnees, sortie, meta, args, appareil)
    if args.quoi in ("tout", "coup"):
        resultats["coup"] = entrainer_coup(donnees, sortie, meta, args, appareil)
    (sortie / "resultats.json").write_text(
        json.dumps({**resultats, "meta": meta, "secondes": round(time.time() - debut), "appareil": appareil}, indent=1),
        encoding="utf-8",
    )
    print(f"fini en {round(time.time() - debut)} s", flush=True)


if __name__ == "__main__":
    main()
