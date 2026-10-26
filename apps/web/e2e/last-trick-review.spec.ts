import { chooseOption } from './helpers';
import {test,expect,type Page} from '@playwright/test';
import {startTestServer,newPlayer,playStep,createRoom,joinByCode,launch} from './helpers';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('../../outputs/playtest-20260915/issue19');

async function untilVerdict(page:Page){
 const start=Date.now();
 while(Date.now()-start<45000 && !(await page.getByTestId('trick-verdict').isVisible().catch(()=>false))){await playStep(page);await page.waitForTimeout(80)}
 await expect(page.getByTestId('trick-verdict')).toBeVisible();
}

for(const [mode,width,height,seats,mobile] of [['portrait',390,780,8,true],['paysage-desktop',844,390,8,false],['court-desktop',652,300,5,false],['desktop',1440,900,5,false]] as const){
 test.describe(mode,()=>{
  test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  test('le dernier pli reste lisible jusqu’à Continuer',async({browser})=>{
   const server=await startTestServer();
   const player=await newPlayer(browser,server.base,'Alix le joyeux',{testFlag:{seed:'playtest-20260915',botDelay:[30,60]}});
   const p=player.page;
   try{
    await p.getByTestId('solo').click();
    await chooseOption(p.getByLabel('Nombre de flibustiers',{exact:true}), String(seats));
    await p.getByTestId('rules-settings').locator('summary').click();
    await chooseOption(p.getByTestId('preset-select'), 'full');
    await chooseOption(p.getByTestId('deals-select'), 'custom');
    await p.getByTestId('deals-custom-rounds').focus();await p.keyboard.press('Home');
    await p.getByTestId('deals-custom-start').focus();await p.keyboard.press('Home');
    await p.getByTestId('launch').click();await untilVerdict(p);
    await p.waitForTimeout(4700);
    const verdict=p.getByTestId('trick-verdict');
    await expect(verdict).toContainText('Continuer');
    await expect(p.getByTestId('confirm-card')).toHaveCount(0);
    await expect(p.getByText('Sélectionne une carte, puis confirme.',{exact:true})).toHaveCount(0);
    const cards=p.locator('.trick .fly');await expect(cards).toHaveCount(seats);
    for(const card of await cards.all())await expect(card).toHaveCSS('opacity','1');
    const measures=await verdict.evaluate(el=>{
     const rect=(node:Element)=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height}};
     const action=el.querySelector('[data-testid=verdict-skip]')!;
     return{box:rect(el),action:rect(action),font:getComputedStyle(action.querySelector('span')!).fontSize,text:[...el.querySelectorAll('.verdict-line,.verdict-detail,.verdict-note')].map(rect),bodyWidth:document.documentElement.scrollWidth};
    });
    expect(measures.box.y).toBeGreaterThanOrEqual(0);expect(measures.box.bottom).toBeLessThanOrEqual(height);
    expect(measures.action.h).toBeGreaterThanOrEqual(28);expect(parseFloat(measures.font)).toBeGreaterThanOrEqual(14);
    for(const r of measures.text)expect(r.bottom).toBeLessThanOrEqual(measures.action.y+1);
    expect(measures.bodyWidth).toBeLessThanOrEqual(width);
    fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/${mode}.json`,JSON.stringify(measures,null,2));
    await p.screenshot({path:`${out}/${mode}.png`});
    if(mobile)await verdict.tap();else{await verdict.focus();await p.keyboard.press('Enter')}
    await expect(p.getByTestId('score')).toBeVisible({timeout:2500});
    expect(player.errors).toEqual([]);
   }finally{await player.ctx.close();await server.close()}
  });
 });
}

test('en ligne : les plis intermédiaires et le dernier progressent sans validation',async({browser})=>{
 const server=await startTestServer();
 const a=await newPlayer(browser,server.base,'Alix le joyeux');
 const b=await newPlayer(browser,server.base,'Camille');
 try{
  const code=await createRoom(a.page,{bots:3,preset:'classic',deals:'standard',timer:'Sans limite'});
  await joinByCode(b.page,code);await launch(a.page);
  const playBoth=async()=>{const start=Date.now();while(Date.now()-start<45000 && !(await a.page.getByTestId('trick-verdict').isVisible().catch(()=>false))){await playStep(a.page);await playStep(b.page);await a.page.waitForTimeout(80)}await expect(a.page.getByTestId('trick-verdict')).toBeVisible()};
  await playBoth();await expect(a.page.getByTestId('trick-verdict')).toContainText('Passer');
  await expect(a.page.getByTestId('confirm-card')).toHaveCount(0);
  await expect(a.page.getByTestId('score')).toBeVisible({timeout:9000});
  await a.page.getByTestId('ready').click();await b.page.getByTestId('ready').click();
  await expect(a.page.getByTestId('round')).toHaveAttribute('data-cards','2');
  await playBoth();await expect(a.page.getByTestId('trick-verdict')).toContainText('Passer');
  await expect(a.page.getByTestId('trick-verdict')).toBeHidden({timeout:5000});
  await expect(a.page.getByTestId('hand')).toHaveAttribute('data-count','1');
  await expect(a.page.getByTestId('score')).toHaveCount(0);
  expect(a.errors).toEqual([]);expect(b.errors).toEqual([]);
 }finally{await a.ctx.close();await b.ctx.close();await server.close()}
});
