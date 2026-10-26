import { defineConfig } from '@playwright/test';

// E2E : `npx playwright test <fichier>` (après `pnpm --filter @flibuste/web build`, le serveur sert dist/).
// Machine modeste (2 CPU) : un seul worker, un fichier à la fois ; captures seulement en échec.
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    screenshot: 'only-on-failure',
  },
});
