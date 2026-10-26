import {test,expect} from '@playwright/test';
import {newPlayer,createRoom,joinByCode,launch,setRounds,startTestServer,closeAll,playUntilScore,scoreTotals,type Player,type TestServer} from './helpers';
let ts:TestServer;const players:Player[]=[];
test.beforeAll(async()=>{ts=await startTestServer()});
test.afterAll(async()=>{await closeAll(players);await ts?.close()});
test('eight human seats complete a real online game, including a returning player',async({browser})=>{
  test.setTimeout(180000);
  for(let i=0;i<8;i++)players.push(await newPlayer(browser,ts.base,'Capitaine '+(i+1)));
  const host=players[0].page;const code=await createRoom(host,{timer:'Sans limite'});setRounds(ts.server,code,1);
  for(const player of players.slice(1))await joinByCode(player.page,code);
  await expect(host.locator('[data-seat]')).toHaveCount(8);
  await players[7].page.reload();await expect(players[7].page.locator('[data-seat]')).toHaveCount(8);
  await launch(host);await Promise.all(players.map(p=>playUntilScore(p.page,{bid:'one',timeout:90000})));
  const expected=await scoreTotals(host);expect(Object.values(expected).every(Number.isFinite)).toBe(true);
  for(const player of players){expect(await scoreTotals(player.page)).toEqual(expected);expect(player.errors).toEqual([])}
  console.log('Eight connected humans, synchronized finite scores:',JSON.stringify(expected));
});
