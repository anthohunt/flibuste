import { chooseOption } from './helpers';
import { test, expect } from '@playwright/test';
import { startTestServer, newPlayer, playStep } from './helpers';

test('la même musique continue du jeu au bilan et au podium', async ({ browser }) => {
 const server = await startTestServer();
 const player = await newPlayer(browser, server.base, 'Alix le joyeux', {testFlag:{seed:'music-scores',botDelay:[30,60]}});
 const p = player.page;
 try {
  await p.addInitScript(() => {
   const media: HTMLAudioElement[] = [];
   (window as unknown as {musicProbe: HTMLAudioElement[]}).musicProbe = media;
   const NativeAudio = window.Audio;
   window.Audio = class extends NativeAudio { constructor(src?:string){super(src);media.push(this);} };
  });
  await p.reload(); await p.getByTestId('enter-tavern').click();
  await p.getByTestId('solo').click();
  await chooseOption(p.getByLabel('Nombre de flibustiers',{exact:true}), '3');
  await p.getByTestId('rules-settings').locator('summary').click();
  await chooseOption(p.getByTestId('preset-select'), 'classic');
  await chooseOption(p.getByTestId('deals-select'), 'custom');
  await p.getByTestId('deals-custom-rounds').focus(); await p.keyboard.press('Home');
  await p.getByTestId('deals-custom-start').focus(); await p.keyboard.press('Home');
  await p.getByTestId('launch').click();
  const current = () => p.evaluate(() => {
   const media = (window as unknown as {musicProbe: HTMLAudioElement[]}).musicProbe;
   const a=media.find(a=>!a.paused && a.src.includes('/music/') && !a.src.includes('/music/accueil'));
   return a ? {index:media.indexOf(a),src:a.src,time:a.currentTime}:null;
  });
  await expect.poll(current).not.toBeNull();
  const before=(await current())!;
  const until=Date.now()+45000;
  while(Date.now()<until && !await p.getByTestId('trick-verdict').isVisible().catch(()=>false)) {await playStep(p);await p.waitForTimeout(60);}
  await p.getByTestId('trick-verdict').click();
  await expect(p.getByTestId('score')).toBeVisible();
  const score=(await current())!;
  expect(score?.index).toBe(before.index);expect(score?.src).toBe(before.src);expect(score?.time).toBeGreaterThan(before.time);
  await p.getByTestId('next-round').click();
  await expect(p.getByTestId('gameover')).toBeVisible();
  const over=(await current())!;
  expect(over?.index).toBe(before.index);expect(over?.src).toBe(before.src);expect(over?.time).toBeGreaterThanOrEqual(score.time);
  await p.getByRole('button',{name:'Retour à la taverne',exact:true}).click();
  await expect(p.getByTestId('home')).toBeVisible();
  await expect.poll(current).toBeNull();
  expect(player.errors).toEqual([]);
 } finally {await player.ctx.close();await server.close();}
});
