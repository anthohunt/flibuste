import { expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.join(os.tmpdir(), 'flibuste-a11y');
export async function auditScreen(page: Page, name: string, scope?: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core/axe.min.js') });
  const results = await page.evaluate(async (scope) => (window as any).axe.run(scope ? document.querySelector(scope) : document, { resultTypes: ['violations'] }), scope);
  fs.mkdirSync(`${root}/accessibility`, { recursive: true });
  fs.writeFileSync(`${root}/accessibility/${name}.json`, JSON.stringify(results.violations, null, 2));
  const blocking = results.violations.filter((v:any) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v:any) => ({id:v.id,nodes:v.nodes.map((n:any)=>n.target)})), `Accessibilité ${name}`).toEqual([]);
}
export async function capture(page: Page, folder: string, name: string) {
  fs.mkdirSync(`${root}/${folder}`, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  await page.screenshot({path:`${root}/${folder}/${name}.png`});
}
