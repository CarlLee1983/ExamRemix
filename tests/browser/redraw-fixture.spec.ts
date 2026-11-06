import { expect,test,type Page,type Route } from '@playwright/test';
import { subjectFixture,addAlternatives,review } from '../fixtures/composition/subjects.ts';
import type { PreviewState } from '../../src/domain/composition-preview.ts';
async function state(page:Page):Promise<PreviewState>{return JSON.parse(await page.locator('#state').innerText());}
async function load(page:Page,input:ReturnType<typeof subjectFixture>,scope='math'){
 await page.route('**/fixture.json',route=>route.fulfill({json:input}));await page.locator('#scope').fill(scope);await page.getByText('Load snapshot',{exact:true}).click();await expect(page.locator('#status')).toHaveText('ready');
 await page.unroute('**/fixture.json');
}
async function generate(page:Page,seed:string,status='success'){await page.locator('#seed').fill(seed);await page.getByText('Generate',{exact:true}).click();await expect(page.locator('#status')).toHaveText(status);await expect.poll(async()=>(await state(page)).pending).toBe(false);}
async function layout(page:Page){await page.route('**/layout-ready',route=>route.fulfill({body:'ready'}));await page.getByText('Check layout readiness').click();await expect(page.locator('#print')).toBeEnabled();await page.unroute('**/layout-ready');}
test.beforeEach(async({page})=>{await page.goto('/tests/fixtures/redraw-browser/');await expect(page.locator('#status')).toHaveText('idle');});

test('actual core success and impossible redraw preserve paper, answers and paper size',async({page})=>{
 await load(page,subjectFixture('數學'));await generate(page,'first');await page.locator('#answers').check();await page.locator('#size').selectOption('A3');await layout(page);
 const before=await state(page);await generate(page,'same-only','redraw-impossible');const after=await state(page);
 expect(after.paper).toEqual(before.paper);expect(after.answers).toBe(true);expect(after.paperSize).toBe('A3');await expect(page.locator('#print')).toBeEnabled();
 await load(page,addAlternatives(subjectFixture('數學'),14));await generate(page,'new-snapshot');expect((await state(page)).paper?.operation.mode).toBe('version-restart');
 await generate(page,'actual-redraw');expect((await state(page)).paper?.operation.changed).toBe(14);
});

test('real bounded solver stops at limit and preserves the previous complete paper',async({page})=>{
 const input=addAlternatives(subjectFixture('數學'),41);input.conflicts.pairs=input.profile.sections.flatMap(s=>s.slots).map(s=>({kind:'question',ids:[s.candidates[0]!.id,s.candidates[1]!.id],reason:'checked'}));
 await load(page,input);await generate(page,'limit-first');const before=(await state(page)).paper;
 await generate(page,'limit-next','search-limit');expect((await state(page)).paper).toEqual(before);
});

test('late redraw and range load cannot override newer requests',async({page})=>{
 await load(page,addAlternatives(subjectFixture('數學'),14));
 await page.evaluate(()=>{const seed=document.querySelector<HTMLInputElement>('#seed')!,button=document.querySelector<HTMLButtonElement>('#generate')!;seed.value='old';button.click();seed.value='new';button.click();});
 await expect.poll(async()=>(await state(page)).paper?.seed).toBe('new');
 let held!:Route,count=0;await page.route('**/fixture.json',route=>{if(++count===1)held=route;else return route.fulfill({json:subjectFixture('英語')});});await page.locator('#scope').fill('chinese');await page.getByText('Load snapshot',{exact:true}).click();await expect.poll(()=>!!held).toBe(true);
 await page.locator('#scope').fill('english');await page.getByText('Load snapshot',{exact:true}).click();await expect(page.locator('#status')).toHaveText('ready');await generate(page,'english');await held.fulfill({json:subjectFixture('國語')});await page.unroute('**/fixture.json');
 await expect.poll(async()=>(await state(page)).scope).toBe('english');expect((await state(page)).paper?.seed).toBe('english');
});

test('version revalidation and layout revisions protect print readiness',async({page})=>{
 const input=subjectFixture('英語');await load(page,input,'english');await generate(page,'v1');await layout(page);
 let held!:Route;await page.route('**/layout-ready',route=>{held=route;});await page.getByText('Check layout readiness').click();await expect.poll(()=>!!held).toBe(true);
 await page.locator('#answers').check();await expect(page.locator('#print')).toBeDisabled();await held.fulfill({body:'old readiness'});await page.unroute('**/layout-ready');await expect(page.locator('#print')).toBeDisabled();await layout(page);
 input.conflicts.revision='v2';await load(page,input,'english');expect((await state(page)).restart).toBe(true);await generate(page,'v2');expect((await state(page)).paper?.operation.mode).toBe('version-restart');await layout(page);
 input.imageHashes={...input.imageHashes,'synthetic.png':'1'.repeat(64)};review(input);await load(page,input,'english');await expect(page.locator('#print')).toBeDisabled();expect((await state(page)).diagnostics.some(d=>d.message.includes('圖片'))).toBe(true);
 await generate(page,'new-image');expect((await state(page)).paper?.operation.mode).toBe('version-restart');
 await page.route('**/fixture.json',route=>route.fulfill({status:500}));await page.getByText('Load snapshot',{exact:true}).click();await expect(page.locator('#status')).toHaveText('load-error');expect((await state(page)).paper?.seed).toBe('new-image');await expect(page.locator('#print')).toBeDisabled();
});
