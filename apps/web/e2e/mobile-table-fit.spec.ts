import { chooseOption } from './helpers';
import {test,expect} from '@playwright/test';
import {startTestServer,type TestServer} from './helpers';
let ts:TestServer;
test.beforeAll(async()=>{ts=await startTestServer()});test.afterAll(async()=>{await ts.close()});
for(const [width,height,count] of [[390,720,5],[360,640,5],[390,844,8],[844,390,5],[844,390,8]]) {
 test(`10 cartes, table et actions visibles : ${width}x${height}, ${count} joueurs`,async({browser})=>{
  const ctx=await browser.newContext({viewport:{width,height}});const p=await ctx.newPage();
  try{
   await p.addInitScript(()=>sessionStorage.setItem('flibuste:test','1'));
   await p.goto(ts.base);await p.getByTestId('enter-tavern').click();await p.getByTestId('home').waitFor();
   for(const phase of ['bidding','playing']){
    await p.evaluate(({count,phase})=>{
     const players=Array.from({length:count},(_,i)=>i?'bot'+i:'me');const hands=Object.fromEntries(players.map(id=>[id,Array.from({length:10},(_,i)=>({id:id+i,kind:'number',suit:'parrot',rank:i+1}))]));
     (window as any).__flibuste.startScenarioSolo({players,me:'me',hands,bids:Object.fromEntries(players.map(id=>[id,phase==='bidding'?null:1])),trick:{leader:'me',plays:[]}});
    },{count,phase});
    await p.getByTestId('hand').waitFor();await expect(p.getByTestId('hand')).toHaveAttribute('data-count','10');
    const action=phase==='bidding'?p.getByTestId('bid-picker').getByRole('button').last():p.getByTestId('confirm-card');
    if(phase==='playing')await p.locator('.hand-card[data-legal=true]').first().click();
    await expect(action).toBeEnabled();
    await expect.poll(async()=>p.evaluate(()=>{
     const board=document.querySelector('[data-testid=table-zone]')!.getBoundingClientRect();
     const hand=document.querySelector('.hand-box')!.getBoundingClientRect();
     return document.documentElement.scrollHeight<=innerHeight+2 && board.top>=0 && hand.bottom<=innerHeight;
    })).toBe(true);
    if(width>height){
     await expect.poll(()=>p.evaluate(()=>Array.from(document.querySelectorAll('.seat-plaque')).every(el=>{
      const plaque=el.getBoundingClientRect();
      return Array.from(el.children).every(child=>{
       const b=child.getBoundingClientRect();return b.left>=plaque.left-1 && b.right<=plaque.right+1;
      });
     }))).toBe(true);
     const own=await p.locator('.seat-me').boundingBox();
     const zone=await p.getByTestId('table-zone').boundingBox();
     expect(own!.y+own!.height).toBeLessThanOrEqual(Math.min(height,zone!.y+zone!.height));
     await expect(p.locator('.seat-plaque').first()).toHaveCSS('width','112px');
     if(count===8)await p.screenshot({path:`../../outputs/worn-responsive/paysage/table-huit-${phase}.png`});
    }
    // Browser chrome resizing and attempted scrolling must not move gameplay out of view.
    for(const nextHeight of [height-70,height]){
     await p.setViewportSize({width,height:nextHeight});
     await p.mouse.move(width/2,nextHeight/2);await p.mouse.wheel(0,550);
     await p.evaluate(()=>window.scrollTo(0,500));
     await expect.poll(()=>p.evaluate(()=>{
      const h=document.querySelector('.hand-box')!.getBoundingClientRect();
      return scrollY===0 && h.bottom<=innerHeight+1;
     })).toBe(true);
    }
    if(phase==='bidding' && width<height){
     const sheet=await p.getByTestId('bid-sheet').boundingBox();
     const zone=await p.getByTestId('table-zone').boundingBox();
     expect(sheet!.y).toBeGreaterThan(zone!.y);
     expect(sheet!.y+sheet!.height).toBeLessThan(zone!.y+zone!.height);
     await chooseOption(p.getByTestId('bid-value'), '1');
    }
    const box=await action.boundingBox();expect(box).not.toBeNull();expect(box!.y+box!.height).toBeLessThanOrEqual(height);
    await action.click();
    if(phase==='playing')await expect(p.getByTestId('hand')).toHaveAttribute('data-count','9');
   }
  }finally{await ctx.close()}
 });
}
