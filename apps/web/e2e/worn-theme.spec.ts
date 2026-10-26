import { chooseOption } from './helpers';
import {test,expect,type Page} from '@playwright/test';
import {startTestServer,newPlayer,createRoom,joinByCode,launch,setRounds,playStep,playUntilScore} from './helpers';
import path from 'node:path';
const out=path.resolve('../../outputs/worn-responsive');
async function shot(p:Page,name:string,mode:string){
 await p.locator('#boot').waitFor({state:'detached'});
 await p.evaluate(()=>document.fonts.ready);
 await p.mouse.move(2,2);
 await p.waitForTimeout(350);
 await p.screenshot({path:`${out}/${mode}/${name}.png`,fullPage:true});
 expect(await p.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(p.viewportSize()!.width);
}
for (const [mode,width,height,mobile] of [['portrait',390,844,true],['paysage',844,390,true],['desktop',1440,900,false]] as const) {
test.describe(mode,()=>{
 test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
test('matières : menus, dialogues et partie complète sur backend réel',async({browser})=>{
 test.setTimeout(240000);
 const server=await startTestServer();
 const alice=await newPlayer(browser,server.base,'Alix le joyeux');
 const bob=await newPlayer(browser,server.base,'Camille');
 const p=alice.page;
 await p.emulateMedia({reducedMotion:'reduce'});
 try {
  await p.goto(server.base); await shot(p,'01-entree',mode); await p.getByTestId('enter-tavern').click();
  await shot(p,'02-accueil-mobile',mode);

  for(const [id,name] of [['reglages-open','04-reglages'],['codex-open','05-codex'],['report-open','06-signalement'],['help','07-aide']]){
   await p.getByTestId(id).click(); await expect(p.getByRole('dialog').first()).toBeVisible(); await shot(p,name,mode);
   await p.keyboard.press('Escape'); await expect(p.getByRole('dialog')).toHaveCount(0);
  }
  await p.getByTestId('classement-open').click(); await shot(p,'08-classement',mode);
  await p.goto(server.base);await p.getByTestId('enter-tavern').click();
  await p.getByTestId('solo').click();await chooseOption(p.getByLabel('Nombre de flibustiers'), '8');await expect(p.getByLabel('Nombre de flibustiers')).toHaveCSS('border-image-source','none');await shot(p,'09-solo',mode);
  await p.getByTestId('rules-settings').locator('summary').click();await shot(p,'10-regles-solo',mode);
  await p.goto(server.base);await p.getByTestId('enter-tavern').click();await p.getByTestId('friends').click();await shot(p,'11-amis',mode);
  await p.goto(server.base);await p.getByTestId('enter-tavern').click();
  const code=await createRoom(p,{bots:2});setRounds(server.server,code,1);await joinByCode(bob.page,code);await shot(p,'12-salon',mode);
  await p.getByTestId('share').click();await shot(p,'13-invitation',mode);await p.keyboard.press('Escape');
  await launch(p);await expect(p.getByTestId('bid-picker')).toBeVisible();await shot(p,'14-pari',mode);

  await playStep(p,'one');await playStep(bob.page,'one');await expect(p.locator('[data-phase="playing"]')).toBeVisible();await shot(p,'16-table-jeu',mode);
  await p.getByTestId('quit').click();await shot(p,'17-quitter',mode);await p.keyboard.press('Escape');
  await Promise.all([playUntilScore(p),playUntilScore(bob.page)]);await shot(p,'18-scores',mode);
  await p.getByTestId('ready').click();await bob.page.getByTestId('ready').click();await expect(p).toHaveURL(/#\/over$/);await shot(p,'19-podium',mode);
  expect(alice.errors).toEqual([]);expect(bob.errors).toEqual([]);
 }finally{await alice.ctx.close();await bob.ctx.close();await server.close();}
});

});
}
