/** Resuming Safari audio can hang forever. A gesture gets one bounded attempt;
 * a later explicit retry may replace the graph, and stale promises have no effect. */
export interface ResumableAudio { readonly state: string; resume(): Promise<void>; }
export class AudioRecovery {
  needsAction=false;
  private attempt?:Promise<boolean>; private cancel?:()=>void; private generation=0;
  constructor(private context:(replace:boolean)=>ResumableAudio,private timeout=1500){}
  run(replace=false):Promise<boolean>{
    if(this.attempt)return this.attempt;
    const generation=++this.generation;
    let finish!:(ok:boolean)=>void;
    const result=new Promise<boolean>(resolve=>finish=resolve);this.attempt=result;
    const settle=(ok:boolean)=>{if(generation!==this.generation)return;clearTimeout(timer);this.needsAction=!ok;this.attempt=undefined;this.cancel=undefined;this.generation++;finish(ok);};
    const timer=setTimeout(()=>settle(false),this.timeout);
    this.cancel=()=>{clearTimeout(timer);this.generation++;this.attempt=undefined;this.cancel=undefined;finish(false);};
    try{const ctx=this.context(replace);if(ctx.state==='running')settle(true);else void ctx.resume().then(()=>settle(ctx.state==='running'),()=>settle(false));}
    catch{settle(false);}
    return result;
  }
  stop(){this.cancel?.();}
}
