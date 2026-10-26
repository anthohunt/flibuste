import { expect, test } from '@playwright/test';
import { startTestServer } from './helpers';
import { auditScreen, capture } from './playtest-audit';
for (const [name,width,height,mobile] of [['phone',390,780,true],['laptop',1440,900,false]] as const) {
 test.describe(name,()=>{
  test.use({viewport:{width,height},isMobile:mobile,hasTouch:mobile});
  test('notice, vocabulaire accueil et embarquement',async({page})=>{
   const server=await startTestServer();
   try{
    await page.goto(server.base);
    await auditScreen(page,`${name}-entry`);
    await capture(page,'menus',`${name}-entry`);
    await page.getByTestId('enter-tavern').click();
    await expect(page.getByTestId('home')).toBeVisible();
    await auditScreen(page,`${name}-home`);
    await capture(page,'menus',`${name}-home`);
    await page.getByTestId('friends').click();
    await page.getByLabel('Nom de pirate',{exact:true}).fill('Alix le joyeux');
    await expect(page.getByLabel('Code d’embarquement')).toBeVisible();
    await auditScreen(page,`${name}-friends`);
    await capture(page,'menus',`${name}-friends`);
    await page.getByRole('button',{name:'Retour à la taverne',exact:true}).click();
    await expect(page.getByTestId('home')).toBeVisible();
   }finally{await server.close()}
  });
 });
}
