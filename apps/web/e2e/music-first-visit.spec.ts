import { chromium, expect, test, type Page } from '@playwright/test';
import { startTestServer, type TestServer } from './helpers';

let server: TestServer;
test.beforeAll(async () => { server = await startTestServer(); });
test.afterAll(async () => { await server.close(); });

// Observe real audio objects without replacing their playback or browser permission behavior.
async function observe(page: Page) {
  await page.addInitScript(() => {
    const probe = { media: [] as HTMLAudioElement[], contexts: [] as AudioContext[], gains: [] as GainNode[] };
    (window as unknown as { soundProbe: typeof probe }).soundProbe = probe;
    const NativeAudio = window.Audio;
    const NativeContext = window.AudioContext;
    window.Audio = class extends NativeAudio {
      constructor(src?: string) { super(src); probe.media.push(this); }
    };
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super(options); probe.contexts.push(this); }
      createGain(): GainNode { const gain = super.createGain(); probe.gains.push(gain); return gain; }
    };
  });
}
async function playing(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { soundProbe: { media: HTMLAudioElement[]; contexts: AudioContext[] } }).soundProbe;
    return p.contexts.some(c => c.state === 'running') && p.media.some(a => !a.paused && a.currentTime > 0.15);
  });
}

for (const gesture of ['touch', 'keyboard'] as const) {
  test(`première visite refusée : la musique démarre au premier geste ${gesture}`, async () => {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=user-gesture-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplay'] });
    try {
      const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await observe(page);
      // A cold, slow media response must not consume the only opportunity to unlock playback.
      await page.route('**/audio/music/*', async route => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.continue();
      });
      await page.goto(server.base);
      await expect(page.getByTestId('entry-notice')).toBeVisible();
      await expect(page.getByTestId('home')).toHaveCount(0);
      expect(await playing(page)).toBe(false);
      expect(await page.evaluate(() => (window as unknown as { soundProbe: { media: HTMLAudioElement[] } }).soundProbe.media.every(a => a.paused && a.currentTime === 0))).toBe(true);
      const enter = page.getByTestId('enter-tavern');
      if (gesture === 'touch') {
        const box = (await enter.boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      } else { await enter.focus(); await page.keyboard.press('Enter'); }
      await expect(page.getByTestId('home')).toBeVisible();
      await expect.poll(() => playing(page), { timeout: 15000 }).toBe(true);
      await expect.poll(() => page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Flibuste Online');
      expect(await page.evaluate(() => navigator.mediaSession.metadata?.artwork.map(image => new URL(image.src).pathname))).toEqual(['/brand/emblem-v1-192.png', '/brand/emblem-v1-512.png']);
      await expect(page.getByTestId('enable-music')).toHaveCount(0);
      await page.getByTestId('solo').click();
      await page.getByTestId('back-home').click();
      expect(await page.evaluate(() => (window as unknown as { soundProbe: { media: HTMLAudioElement[] } }).soundProbe.media.length)).toBe(1);
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  });
}

test('même avec autoplay autorisé : silence avant entrée, musique après', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await observe(page);
    await page.goto(server.base);
    await expect(page.getByTestId('entry-notice')).toBeVisible();
    expect(await playing(page)).toBe(false);
    await page.getByTestId('enter-tavern').click();
    await expect.poll(() => playing(page), { timeout: 15000 }).toBe(true);
    await expect(page.getByTestId('enable-music')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('entry-notice')).toBeVisible();
    expect(await playing(page)).toBe(false);
  } finally { await browser.close(); }
});

// Un vrai lecteur prépare son décodeur avant le geste ; la piste garde son attaque à t=0.
test('piste prête : entrée et premier son synchronisés sans reconstruire le lecteur', async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
  try {
    const page = await browser.newPage();
    await observe(page);
    await page.goto(server.base);
    await expect(page.getByTestId('enter-tavern')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const p = (window as unknown as { soundProbe: { media: HTMLAudioElement[] } }).soundProbe;
      return p.media.find(a => a.src.includes('/music/accueil'))?.readyState ?? 0;
    })).toBeGreaterThanOrEqual(3);
    const before = await page.evaluate(() => {
      const a = (window as unknown as { soundProbe: { media: HTMLAudioElement[] } }).soundProbe.media[0]!;
      const observed = window as unknown as { firstMusicPlaying?: number; entryClick?: number };
      a.addEventListener('playing', () => { observed.firstMusicPlaying ??= performance.now(); });
      document.querySelector('[data-testid="enter-tavern"]')!.addEventListener('click', () => { observed.entryClick = performance.now(); }, { capture: true });
      return { paused: a.paused, time: a.currentTime };
    });
    expect(before).toEqual({ paused: true, time: 0 });
    await page.getByTestId('enter-tavern').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect.poll(() => playing(page)).toBe(true);
    const timing = await page.evaluate(() => {
      const w = window as unknown as { firstMusicPlaying: number; entryClick: number; soundProbe: { media: HTMLAudioElement[] } };
      return { delay: w.firstMusicPlaying - w.entryClick, count: w.soundProbe.media.filter(a => a.src.includes('/music/accueil')).length };
    });
    expect(timing.count).toBe(1);
    expect(timing.delay).toBeGreaterThanOrEqual(0);
    expect(timing.delay).toBeLessThan(300);
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(await playing(page)).toBe(true);
    await test.info().attach('music-start-timing', { body: JSON.stringify(timing), contentType: 'application/json' });
  } finally { await browser.close(); }
});

test('ambiance prémixée : même lecteur et réglage Musique, effets indépendants, muet respecté', async ({ page }) => {
  await observe(page);
  await page.goto(server.base);
  await page.getByTestId('enter-tavern').click();
  await expect.poll(() => playing(page)).toBe(true);
  const current = () => page.evaluate(() => {
    const p = (window as unknown as { soundProbe: { media: HTMLAudioElement[]; gains: GainNode[] } }).soundProbe;
    return { media: p.media.length, music: p.gains[2]?.gain.value, effects: p.gains[1]?.gain.value };
  });
  expect(await current()).toMatchObject({ media: 1, music: expect.closeTo(0.55, 4) });
  await page.getByTestId('reglages-open').click();
  await page.getByTestId('reglages-son-curseur-musique').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('reglages-son-valeur-musique')).toHaveText('100 %');
  await page.getByTestId('reglages-son-curseur-effets').focus();
  await page.keyboard.press('Home');
  expect(await current()).toEqual({ media: 1, music: 1, effects: 0 });
  expect(await playing(page)).toBe(true);
  await page.getByTestId('reglages-son-muet').click();
  await expect.poll(() => playing(page)).toBe(false);
  await page.getByTestId('reglages-son-muet').click();
  await expect.poll(() => playing(page)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('entry-notice')).toBeVisible();
  expect(await playing(page)).toBe(false);
  await page.getByTestId('enter-tavern').click();
  await expect.poll(() => playing(page)).toBe(true);
  expect(await current()).toEqual({ media: 1, music: 1, effects: 0 });
});
