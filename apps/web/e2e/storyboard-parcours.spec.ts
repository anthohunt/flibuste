import { chooseOption } from './helpers';
import {test,expect} from '@playwright/test';
import {startTestServer,newPlayer,createRoom,playUntilScore,launch,closeAll,setRounds,type Player,type TestServer} from './helpers';
let ts:TestServer;const players:Player[]=[];
test.beforeAll(async()=>{ts=await startTestServer()});test.afterAll(async()=>{await closeAll(players);await ts.close()});
test('parcours validé : nom au bon moment, tablées 2/4/8 sans personnalisation',async({browser})=>{
 const user=await newPlayer(browser,ts.base,'Alix',{skipName:true,viewport:{width:390,height:844}});players.push(user);const p=user.page;
 await expect(p.getByLabel('Nom de pirate',{exact:true})).toHaveCount(0);
 await expect(p.getByTestId('create')).toHaveCount(0);
 await p.getByTestId('solo').click();await p.getByLabel('Nom de pirate',{exact:true}).fill('Alix');
 for(const n of [2,4,8]){await chooseOption(p.getByLabel('Nombre de flibustiers'), String(n));await expect(p.getByLabel('Nombre de flibustiers')).toHaveAttribute('data-value', String(n));}
 await expect(p.getByTestId('crew-open')).toHaveCount(0);
 await p.getByTestId('launch').click();await expect(p.locator('[data-phase=bidding]')).toBeVisible();
 const r=await p.evaluate(()=>({hand:document.querySelector('.hand-box')!.getBoundingClientRect().bottom,bid:document.querySelector('[data-testid=bid-sheet]')!.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));expect(r.bid).toBeLessThan(r.hand);expect(r.overflow).toBe(false);expect(user.errors).toEqual([]);
});
test('invitation explicite, résultat personnel et même table en reconnexion',async({browser})=>{
 test.setTimeout(90000);
 const host=await newPlayer(browser,ts.base,'Camille',{viewport:{width:390,height:844}}),guest=await newPlayer(browser,ts.base,'Alix',{viewport:{width:390,height:844}});players.push(host,guest);
 const code=await createRoom(host.page,{timer:'Sans limite'});setRounds(ts.server,code,1);
 const p=guest.page;await p.getByTestId('friends').click();await p.getByLabel('Code d’embarquement').fill(code);
 await expect(p.getByTestId('friends-screen')).toBeVisible();await expect(host.page.locator('[data-seat]')).toHaveCount(1);
 await p.getByTestId('join-submit').click();await expect(p.getByTestId('waiting-host')).toBeVisible();await expect(host.page.locator('[data-seat]')).toHaveCount(2);
 await launch(host.page);await expect(p.locator('[data-phase=bidding]')).toBeVisible();
 await guest.ctx.setOffline(true);await expect(p.getByTestId('reconnecting')).toBeVisible({timeout:10000});await p.screenshot({path:'screenshots/parcours-reconnexion.png',fullPage:true});await guest.ctx.setOffline(false);await expect(p.getByTestId('reconnecting')).toHaveCount(0,{timeout:15000});
 await Promise.all([host,guest].map(u=>playUntilScore(u.page,{bid:'one',timeout:40000})));await expect(p.getByTestId('personal-result')).toBeVisible();await p.screenshot({path:'screenshots/parcours-resultat.png',fullPage:true});
 expect(host.errors).toEqual([]);expect(guest.errors).toEqual([]);
});
