#!/usr/bin/env node
// Chaîne d'encodage audio du jeu.
//   sfx  <entree> <sortie-sans-extension> [--gain=dB] [--trim] -> .webm (opus mono) + .m4a (aac mono)
//   music <entree> <sortie-sans-extension>                     -> .webm (opus stereo) + .m4a (aac stereo)
// Les effets sont normalisés en CRÊTE (préserve l'attaque), la musique en LOUDNESS EBU R128 (-19 LUFS,
// un fond sonore ne doit jamais couvrir un effet).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
const sh = promisify(execFile)

async function ff(args) {
  const { stdout, stderr } = await sh('ffmpeg', ['-hide_banner', '-y', ...args], { maxBuffer: 64 << 20 })
  return stdout + stderr
}

async function crete(f) {
  const log = await sh('ffmpeg', ['-hide_banner', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'],
    { maxBuffer: 64 << 20 }).then((r) => r.stdout + r.stderr, (e) => String(e.stderr || ''))
  const m = log.match(/max_volume:\s*(-?[0-9.]+) dB/)
  return m ? parseFloat(m[1]) : null
}

async function passeLoudnorm(f) {
  const log = await sh('ffmpeg', ['-hide_banner', '-i', f, '-af',
    'loudnorm=I=-19:TP=-2:LRA=9:print_format=json', '-f', 'null', '-'],
    { maxBuffer: 64 << 20 }).then((r) => r.stdout + r.stderr, (e) => String(e.stderr || ''))
  const j = log.slice(log.lastIndexOf('{'))
  try { return JSON.parse(j.slice(0, j.indexOf('}') + 1)) } catch { return null }
}

async function sfx(entree, base, opts) {
  // La normalisation en crête est INCONDITIONNELLE : c'est elle qui met les 200 sons du jeu au même
  // niveau, et un son qui y échappe s'entend immédiatement comme trop fort ou inaudible. `--gain` n'est
  // donc PAS une valeur absolue qui la remplacerait (le premier jet le faisait, et un `--gain=0` bien
  // intentionné supprimait la normalisation) : c'est un décalage de goût AJOUTÉ par-dessus.
  const c = await crete(entree)
  const normalisation = c == null ? 0 : -3 - c
  const gain = normalisation + (opts.gain ?? 0)
  const chaine = [
    opts.trim ? 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.005' : null,
    `volume=${gain.toFixed(2)}dB`,
    // Rogne la queue : sur un son de jeu, la traîne inaudible ne fait que porter la durée au-dessus de
    // la fenêtre du slot — et c'est la durée ENCODÉE qui compte, pas celle du fichier d'origine.
    'areverse', 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.02', 'areverse',
  ].filter(Boolean).join(',')
  const commun = ['-i', entree, '-af', chaine, '-ac', '1', '-ar', '48000']
  await ff([...commun, '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio', `${base}.webm`])
  await ff([...commun, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', `${base}.m4a`])
  return {
    type: 'sfx', crete_source: c, normalisation: +normalisation.toFixed(2),
    gain_gout: opts.gain ?? 0, gain_applique: +gain.toFixed(2), sorties: await tailles(base),
  }
}

async function music(entree, base) {
  const p = await passeLoudnorm(entree)
  const af = p
    ? `loudnorm=I=-19:TP=-2:LRA=9:measured_I=${p.input_i}:measured_TP=${p.input_tp}:measured_LRA=${p.input_lra}:measured_thresh=${p.input_thresh}:offset=${p.target_offset}:linear=true`
    : 'loudnorm=I=-19:TP=-2:LRA=9'
  const commun = ['-i', entree, '-af', af, '-ac', '2', '-ar', '48000']
  await ff([...commun, '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio', `${base}.webm`])
  await ff([...commun, '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', `${base}.m4a`])
  return { type: 'music', mesure: p ? { i: p.input_i, tp: p.input_tp, lra: p.input_lra } : null, sorties: await tailles(base) }
}

async function tailles(base) {
  const out = {}
  for (const ext of ['webm', 'm4a']) {
    const s = await stat(`${base}.${ext}`).catch(() => null)
    const d = await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${base}.${ext}`])
      .then((r) => +r.stdout.trim(), () => null)
    out[ext] = { octets: s ? s.size : null, duree: d }
  }
  return out
}

const [cmd, entree, base, ...rest] = process.argv.slice(2)
const opts = {
  gain: rest.find((a) => a.startsWith('--gain=')) ? +rest.find((a) => a.startsWith('--gain=')).split('=')[1] : null,
  trim: rest.includes('--trim'),
}
try {
  const r = cmd === 'sfx' ? await sfx(entree, base, opts)
    : cmd === 'music' ? await music(entree, base)
    : (() => { throw new Error('usage: sfx|music <entree> <base-sortie>') })()
  console.log(JSON.stringify(r, null, 2))
} catch (e) {
  console.error(JSON.stringify({ erreur: String(e.message || e).slice(0, 500) }))
  process.exit(1)
}
