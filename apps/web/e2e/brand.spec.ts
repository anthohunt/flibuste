import { test, expect } from '@playwright/test';
import { startTestServer, type TestServer } from './helpers';
let server: TestServer;
test.beforeAll(async () => { server = await startTestServer(); });
test.afterAll(async () => { await server.close(); });
test('identité des icônes, installation et aperçu de lien', async ({ page, request }) => {
 await page.goto(server.base);
 await expect(page).toHaveTitle('Flibuste Online');
 const manifestResponse = await request.get(`${server.base}/manifest.webmanifest`);
 expect(manifestResponse.ok()).toBe(true);
 const manifest = await manifestResponse.json();
 expect(manifest.name).toBe('Flibuste Online');
 const maskable = manifest.icons.find((icon: { purpose?: string }) => icon.purpose === 'maskable');
 expect(maskable.src).toBe('brand/emblem-v1-maskable.png');
 await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/brand/emblem-v1-180.png');
 await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Flibuste Online');
 await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /https?:\/\/[^/]+\/brand\/share-v1.png/);
 for (const [file, width, height] of [['emblem-v1-64.png',64,64], ['emblem-v1-192.png',192,192], ['emblem-v1-512.png',512,512], ['emblem-v1-maskable.png',512,512], ['badge-v1.png',96,96], ['share-v1.png',1200,630]] as const) {
  const res = await request.get(`${server.base}/brand/${file}`);
  expect(res.ok()).toBe(true);
  const dimensions = await page.evaluate(async file => {const image = new Image();image.src=`/brand/${file}`;await image.decode();return [image.naturalWidth,image.naturalHeight];}, file);
  expect(dimensions).toEqual([width,height]);
 }
 await page.getByTestId('enter-tavern').click();await page.getByTestId('solo').click();
 await expect(page).toHaveTitle('Flibuste Online — Salon');
});
