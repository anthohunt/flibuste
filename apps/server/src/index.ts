// Point d'entrée : `pnpm --filter @flibuste/server start` (env PORT, DATA_DIR, WEB_DIST, PUBLIC_URL…,
// voir config.ts). Une exception hors des chemins protégés est loggée, jamais fatale : les parties en
// mémoire survivent à une requête HTTP malformée ou à un timer qui lève.

import { startServer } from './server';

process.on('uncaughtException', (err) => {
  console.error('[flibuste] uncaught exception (kept running):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[flibuste] unhandled rejection (kept running):', reason);
});

startServer()
  .then((srv) => {
    console.log(`[flibuste] listening on :${srv.port} (data ${srv.cfg.dataDir}${srv.cfg.webDist ? `, web ${srv.cfg.webDist}` : ''})`);
    const stop = (signal: string) => {
      console.log(`[flibuste] ${signal}, shutting down`);
      srv.close().then(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  })
  .catch((err) => {
    console.error('[flibuste] failed to start', err);
    process.exit(1);
  });
