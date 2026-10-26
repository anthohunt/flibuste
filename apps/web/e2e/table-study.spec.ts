import {test,expect} from '@playwright/test';
import {startTestServer,newPlayer,createRoom,joinByCode,launch,playStep} from './helpers';
import path from 'node:path';
const out=path.resolve('../../outputs/table-study-v5');
test.skip(process.env.FLIBUSTE_TABLE_STUDY_TEST!=='true','Étude visuelle locale : construire avec VITE_FLIBUSTE_TABLE_STUDY=true');
for(const [mode,width,height,mobile] of [['portrait',390,844,true],['paysage',844,390,true],['laptop',1440,900,false],['paysage-8',844,390,true]] as const){
 test.describe(mode,()=>{
  test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  test('table Blender, vide et partie réelle',async({browser})=>{
   test.setTimeout(150000);
   const server=await startTestServer();
   const alice=await newPlayer(browser,server.base,'Alix le joyeux');
   const bob=await newPlayer(browser,server.base,'Camille');
   const p=alice.page;
   try{
    await p.emulateMedia({reducedMotion:'reduce'});
    const code=await createRoom(p,{bots:mode==='paysage-8'?6:2,preset:'custom',deals:'pret-au-combat',timer:'Sans limite'});
    await joinByCode(bob.page,code);await launch(p);
    await expect(p.getByTestId('bid-picker')).toBeVisible();
    await playStep(p,'one');await playStep(bob.page,'one');
    await expect(p.locator('[data-phase="playing"]')).toBeVisible();
    await expect.poll(()=>p.getByTestId('hand').getAttribute('data-count')).toBe('6');
    // Play through actual controls before holding at the next human turn for review.
    await playStep(p);await playStep(bob.page);await p.waitForTimeout(900);
    await expect(p.getByTestId('blender-table')).toBeVisible();
    await expect.poll(()=>p.locator('[data-testid=table-study-decor] img,[data-testid=blender-table]').evaluateAll(es=>es.every(e=>(e as HTMLImageElement).complete&&(e as HTMLImageElement).naturalWidth>0))).toBe(true);
    const playable=p.locator('.hand-card[data-legal=true]');
    if(await playable.count()){await playable.first().focus();await p.keyboard.press('Enter');}
    await p.evaluate(()=>document.fonts.ready);await p.mouse.click(8,8);await p.mouse.move(2,2);await p.waitForTimeout(800);await p.mouse.click(8,8);await expect(p.getByRole('tooltip')).toBeHidden();
    expect(await p.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(mode.startsWith('paysage')){
     const board=await p.getByTestId('round-table').boundingBox();
     const hand=await p.locator('.hand-box').boundingBox();
     expect(board).not.toBeNull();expect(hand).not.toBeNull();
     expect(Math.abs(board!.x+board!.width/2-width/2)).toBeLessThan(3);
     expect(board!.y+board!.height).toBeLessThanOrEqual(hand!.y+4);
     expect(board!.width/board!.height).toBeGreaterThan(1.45);
     expect(board!.width/board!.height).toBeLessThan(1.75);
     const zone=await p.getByTestId('table-zone').boundingBox();
     const played=p.locator('.trick .fly');
     expect(await played.count()).toBeGreaterThan(0);
     for(const card of await played.all()){
      const r=await card.boundingBox();if(!r)continue;
      expect(r.y).toBeGreaterThanOrEqual(zone!.y-2);
      expect(r.y+r.height).toBeLessThanOrEqual(zone!.y+zone!.height+2);
     }
    }
    await p.screenshot({path:`${out}/${mode}-partie.png`});
    // Same viewport and geometry, hide only game overlays to inspect the underlying decor.
    const clean=await p.addStyleTag({content:'body *{visibility:hidden!important}.scene,.study-decor,.study-decor *,.round-table,.round-table *{visibility:visible!important}'});
    await expect(p.getByTestId('hand')).toBeHidden();
    await expect(p.locator('.seat .name').first()).toBeHidden();
    await expect(p.getByTestId('blender-table')).toBeVisible();
    await p.screenshot({path:`${out}/${mode}-vide.png`});await clean.evaluate(el=>el.remove());
    if(mode==='paysage'){
     await p.setViewportSize({width:390,height:844});
     await expect(p.locator('.table-screen')).not.toHaveClass(/study-landscape/);
     await p.setViewportSize({width:844,height:390});
     await expect(p.locator('.table-screen')).toHaveClass(/study-landscape/);
     await expect(p.getByTestId('hand')).toBeVisible();
    }
    await p.getByTestId('reglages-open').click();await expect(p.getByRole('dialog').first()).toBeVisible();await p.keyboard.press('Escape');
    expect(alice.errors).toEqual([]);expect(bob.errors).toEqual([]);
   }finally{await alice.ctx.close();await bob.ctx.close();await server.close()}
  });
 });
}
