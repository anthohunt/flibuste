// Notifications push « c'est ton tour » (mode asynchrone) : permission, abonnement via le service worker
// avec la clé VAPID du serveur (`GET /api/vapid`), puis `subscribePush` au serveur.
import type { WsClient } from './net';
import type { PushSubscriptionJSON } from './protocol';

export type PushState = 'unsupported' | 'off' | 'denied' | 'busy' | 'on';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function initialPushState(): PushState {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function fetchVapidKey(): Promise<string | null> {
  const res = await fetch('/api/vapid', { cache: 'no-cache' });
  if (!res.ok) return null;
  const body = (await res.json()) as { publicKey?: string | null };
  return body.publicKey ?? null;
}

/**
 * Demande la permission, s'abonne et envoie l'abonnement au serveur.
 * Lève avec un message lisible en cas d'échec (l'appelant l'affiche en toast).
 */
export async function enablePush(client: WsClient): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const key = await fetchVapidKey();
  if (!key) throw new Error('Notifications indisponibles sur ce serveur');
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
  const json = sub.toJSON() as PushSubscriptionJSON;
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('Abonnement push incomplet');
  if (!client.send({ type: 'subscribePush', subscription: { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: json.keys } }))
    throw new Error('Connexion perdue, réessaie dans un instant');
  return 'on';
}
