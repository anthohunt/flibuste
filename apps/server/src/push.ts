// Web Push (VAPID). Les clés sont générées une fois dans DATA_DIR/vapid.json.
// Aucune erreur d'envoi ne remonte : un push raté ne doit jamais faire tomber une partie.

import fs from 'node:fs';
import path from 'node:path';
import webPush from 'web-push';
import type { Db } from './db';
import type { PlayerId } from '@flibuste/engine';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function loadOrCreateVapid(dataDir: string): VapidKeys {
  const file = path.join(dataDir, 'vapid.json');
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<VapidKeys>;
    if (parsed.publicKey && parsed.privateKey) return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  } catch {
    // absent or corrupt: regenerate below
  }
  const keys = webPush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

export class Pusher {
  readonly publicKey: string;

  constructor(
    private readonly db: Db,
    dataDir: string,
    subject: string,
  ) {
    const keys = loadOrCreateVapid(dataDir);
    this.publicKey = keys.publicKey;
    // web-push only accepts an https: or mailto: subject
    const mailto = subject.startsWith('https:') || subject.startsWith('mailto:') ? subject : 'mailto:admin@example.org';
    try {
      webPush.setVapidDetails(mailto, keys.publicKey, keys.privateKey);
    } catch (err) {
      console.warn(`[push] invalid VAPID setup: ${(err as Error).message}`);
    }
  }

  /** Sends a notification to the player if they subscribed. Never throws. */
  async notify(playerId: PlayerId, title: string, body: string, url?: string): Promise<boolean> {
    const sub = this.db.getPushSub(playerId);
    if (!sub) return false;
    try {
      await webPush.sendNotification(sub, JSON.stringify({ title, body, url }), { TTL: 60 * 60 * 24 });
      return true;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) this.db.deletePushSub(playerId); // subscription gone
      console.warn(`[push] failed for ${playerId}: ${(err as Error).message}`);
      return false;
    }
  }
}
