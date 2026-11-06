/** Preview state ownership, without DOM, storage, server writes or production routes. */
import { compositionReviewHash, validateCompositionConfiguration, validateCompositionWitness, type MathCompositionInput, type CompositionDiagnostic } from './paper-composition.ts';
import { assessPreviousPaper, paperOnly, redrawPaper, type RedrawResult, type RedrawWitness } from './paper-redraw.ts';
export interface PreviewState {
 scope:string;paper?:RedrawWitness;layoutRevision:number;answers:boolean;paperSize:'A4'|'A3';printReady:boolean;pending:boolean;
 status:'idle'|'loading'|'ready'|'load-error'|RedrawResult['status'];diagnostics:CompositionDiagnostic[];restart:boolean;
}
export class CompositionPreview {
 private current:PreviewState={scope:'',layoutRevision:0,answers:false,paperSize:'A4',printReady:false,pending:false,status:'idle',diagnostics:[],restart:false};
 private input:MathCompositionInput|undefined;
 private sequence=0;private valid=false;private layoutReady=false;
 get state():PreviewState {return structuredClone(this.current);}
 private invalidateLayout(){this.layoutReady=false;this.current.printReady=false;this.current.layoutRevision++;}
 setAnswers(answers:boolean){if(this.current.answers!==answers)this.invalidateLayout();this.current.answers=answers;}
 setPaperSize(size:'A4'|'A3'){if(this.current.paperSize!==size)this.invalidateLayout();this.current.paperSize=size;}
 setLayoutReady(ready:boolean,revision:number){if(revision!==this.current.layoutRevision)return;this.layoutReady=ready;this.current.printReady=ready && this.valid && !!this.input;}
 async load(scope:string,load:()=>Promise<MathCompositionInput>):Promise<void> {
  const sequence=++this.sequence;
  if(scope!==this.current.scope){this.current.paper=undefined;this.valid=false;this.invalidateLayout();}
  this.current.scope=scope;this.current.status='loading';this.current.pending=true;this.current.printReady=false;this.input=undefined;
  try {
   const input=structuredClone(await load());if(sequence!==this.sequence)return;
   const ready=validateCompositionConfiguration(input);
   if(ready.status!=='ready'){this.current.status=ready.status;this.current.diagnostics=ready.diagnostics;this.current.pending=false;this.valid=false;return;}
   if(ready.profile.reviewedSnapshotHash!==await compositionReviewHash(input)){if(sequence!==this.sequence)return;this.current.status='unconfigured';this.current.diagnostics=[{message:'題庫或圖片核對版本已過期'}];this.current.pending=false;this.valid=false;return;}
   const previous=this.current.paper;
   const assessment=previous?await assessPreviousPaper(input,previous):undefined;if(sequence!==this.sequence)return;
   this.input=input;this.valid=assessment?.valid??false;
   if(previous && !this.valid)this.invalidateLayout();
   this.current.restart=previous?assessment?.sameVersion===false:false;
   this.current.diagnostics=assessment?.diagnostics??[];
   this.current.printReady=this.valid && this.layoutReady;this.current.pending=false;this.current.status='ready';
  } catch(error) {
   if(sequence!==this.sequence)return;
   this.current.status='load-error';this.current.pending=false;this.current.diagnostics=[{message:error instanceof Error?error.message:String(error)}];this.valid=false;
  }
 }
 async generate(seed:string):Promise<void> {
  if(!this.input)return;
  const sequence=++this.sequence;
  const input=structuredClone(this.input),previous=this.current.paper;
  this.current.pending=true;this.current.diagnostics=[];
  try {
   const result=await redrawPaper(input,{seed,...(previous?{previous}: {})});if(sequence!==this.sequence)return;
   if(result.status==='success') {
    const diagnostics=await validateCompositionWitness(input,paperOnly(result.witness));if(sequence!==this.sequence)return;
    if(diagnostics.length){this.current.status='data-error';this.current.diagnostics=diagnostics;this.current.pending=false;return;}
    // This is the only replacement of a successful paper in the generation path.
    this.current.paper=result.witness;this.valid=true;this.invalidateLayout();this.current.restart=false;
   } else this.current.diagnostics=result.diagnostics;
   this.current.status=result.status;this.current.pending=false;
  } catch(error) {
   if(sequence!==this.sequence)return;
   this.current.status='data-error';this.current.pending=false;this.current.diagnostics=[{message:error instanceof Error?error.message:String(error)}];
  }
 }
}
