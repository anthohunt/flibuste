import { test, expect } from '@playwright/test';
import { startTestServer, newPlayer, chooseOption, playStep } from './helpers';
import { auditScreen, capture } from './playtest-audit';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('../../outputs/playtest-20260915/game-ui');

for (const [name,width,height,mobile] of [['phone-small',354,652,true],['phone',390,780,true],['laptop',1440,900,false]] as const){
 test.describe(name,()=>{
  test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  test('sélection, premier joueur, outils et verdict restent accessibles',async({browser})=>{
   const server=await startTestServer();const player=await newPlayer(browser,server.base,'Alix le joyeux',{testFlag:{seed:'playtest-20260915',botDelay:[60,90]}});const p=player.page;
   try{
    fs.mkdirSync(out,{recursive:true});
    await p.getByTestId('solo').click();
    const count=p.getByLabel('Nombre de flibustiers',{exact:true});
    await count.click();await expect(p.getByTestId('themed-select-menu')).toBeVisible();
    await auditScreen(p, `${name}-select`, '[data-testid="themed-select-menu"]');
    await capture(p,'game-ui',`${name}-select`);
    await p.keyboard.press('Escape');await expect(count).toBeFocused();
    await count.click();await expect(p.getByTestId('themed-select-menu')).toBeVisible();
    await p.goBack();await expect(p.getByTestId('themed-select-menu')).toHaveCount(0);await expect(count).toBeFocused();
    await expect(p.getByTestId('launch')).toBeVisible();
    await chooseOption(count,'8');
    await p.getByTestId('rules-settings').locator('summary').click();
    await chooseOption(p.getByTestId('preset-select'),'full');
    await chooseOption(p.getByTestId('deals-select'),'custom');
    await p.getByTestId('deals-custom-rounds').focus();await p.keyboard.press('Home');
    await p.getByTestId('deals-custom-start').focus();await p.keyboard.press('Home');
    await p.getByTestId('launch').click();
    await expect(p.getByTestId('bid-value')).toBeVisible();
    const first=p.locator('[data-badge][data-first="true"]');await expect(first).toHaveCount(1);
    const id=await first.getAttribute('data-badge');
    const actualLeader=await p.evaluate(()=>(window as any).__flibuste.game.view.trick.leader);
    expect(id).toBe(actualLeader);
    await expect(first).toHaveAttribute('aria-label',/joue la première carte/);
    await expect(p.getByTestId('first-player-note')).toBeVisible();
    const toolRects=[];
    for(const name of ['reglages-open','codex-open','report-open','help','quit']){
     const tool=p.getByTestId(name);await expect(tool).toBeInViewport({ratio:1});toolRects.push((await tool.boundingBox())!);
    }
    expect(Math.max(...toolRects.map(b=>b.y))-Math.min(...toolRects.map(b=>b.y))).toBeLessThan(2);
    for(const b of toolRects){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44)}
    await expect(p.getByTestId('game-progress')).toContainText('Manche 1');
    await p.getByTestId('help').click();await expect(p.getByTestId('help-sheet')).toBeVisible();await p.keyboard.press('Escape');
    await p.getByTestId('quit').click();await expect(p.getByRole('dialog')).toBeVisible();await p.keyboard.press('Escape');
    if(mobile){
     const before=await p.evaluate(()=>JSON.stringify((window as any).__flibuste.game.view.hand.map((c:any)=>c.id)));
     await p.setViewportSize({width:844,height:390});await expect(p.getByTestId('portrait-notice')).toBeVisible();
     await capture(p,'game-ui',`${name}-landscape`);
     await expect(p.locator('main')).toHaveAttribute('inert','');
     await p.setViewportSize({width,height});await expect(p.getByTestId('portrait-notice')).toHaveCount(0);
     expect(await p.evaluate(()=>JSON.stringify((window as any).__flibuste.game.view.hand.map((c:any)=>c.id)))).toBe(before);
    }else await expect(p.getByTestId('portrait-notice')).toHaveCount(0);
    await capture(p,'game-ui',`${name}-bid`);
    const until=Date.now()+45000;
    while(Date.now()<until&&!await p.getByTestId('trick-verdict').isVisible().catch(()=>false)){await playStep(p);await p.waitForTimeout(80)}
    await expect(p.getByTestId('trick-verdict')).toBeVisible();
    const winner=await p.evaluate(()=>(window as any).__flibuste.game.shownTrick.winner);
    await expect(p.locator('[data-badge][data-trick-winner="true"]')).toHaveCount(winner?1:0);
    if(winner)await expect(p.locator('[data-badge][data-trick-winner="true"]')).toHaveAttribute('data-badge',winner);
    await expect(p.getByTestId('confirm-card')).toHaveCount(0);
    await capture(p,'game-ui',`${name}-verdict`);
    await p.getByTestId('trick-verdict').click();await expect(p.getByTestId('score')).toBeVisible();
    await auditScreen(p,`${name}-score`);
    await capture(p,'game-ui',`${name}-score`);
    expect(player.errors).toEqual([]);
   }finally{await player.ctx.close();await server.close();}
  });
 });
}
