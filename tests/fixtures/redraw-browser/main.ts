import { CompositionPreview } from '../../../src/domain/composition-preview.ts';
// This page is only a test harness: data and readiness arrive through intercepted fixture requests.
const preview=new CompositionPreview();
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
function render(){const state=preview.state;element('state').textContent=JSON.stringify(state);element('status').textContent=state.status;element<HTMLButtonElement>('print').disabled=!state.printReady;}
function run(promise:Promise<void>){render();void promise.then(render);}
element('load').onclick=()=>run(preview.load(element<HTMLInputElement>('scope').value,async()=>{const response=await fetch('/fixture.json');if(!response.ok)throw Error('snapshot read failed');return response.json();}));
element('generate').onclick=()=>run(preview.generate(element<HTMLInputElement>('seed').value));
element<HTMLInputElement>('answers').onchange=event=>{preview.setAnswers((event.target as HTMLInputElement).checked);render();};
element<HTMLSelectElement>('size').onchange=event=>{preview.setPaperSize((event.target as HTMLSelectElement).value as 'A4'|'A3');render();};
element('layout').onclick=()=>{const revision=preview.state.layoutRevision;void fetch('/layout-ready').then(response=>{preview.setLayoutReady(response.ok,revision);render();});};
render();
