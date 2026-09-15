export interface LabelRect { left:number; top:number; width:number; height:number; }
export interface LootLabel { id:number; x:number; y:number; width:number; height:number; module:boolean; }
// Greedy bounded screen-space packing: modules keep priority over repair labels.
export function placeLootLabels(items:LootLabel[],width:number,top:number,bottom:number,reserved:LabelRect[]=[]){
  const placed=new Map<number,LabelRect>(), occupied:LabelRect[]=[...reserved];
  for(const p of [...items].sort((a,b)=>Number(b.module)-Number(a.module)||a.y-b.y)){
    const w=Math.min(p.width,width<400&&items.filter(i=>i.module).length>1?(width-21)/2:width-16),h=p.height;
    const clamp=(x:number)=>Math.max(8,Math.min(width-w-8,x));
    const left=clamp(p.x-w/2),y=Math.max(top,Math.min(bottom-h,p.y-h/2));
    const candidates:LabelRect[]=[];
    for(const x of [left,left-w-6,left+w+6,left-w/2-3,left+w/2+3,8,width-w-8])for(let row=0;row<=Math.ceil((bottom-top)/8);row++){
      const yy=row===0?y:top+(row-1)*8;if(yy+h>bottom)continue;candidates.push({left:clamp(x),top:yy,width:w,height:h});
    }
    candidates.sort((a,b)=>Math.hypot((a.left-left)*.7,a.top-y)-Math.hypot((b.left-left)*.7,b.top-y));
    const r=candidates.find(a=>occupied.every(b=>a.left+a.width+5<=b.left||b.left+b.width+5<=a.left||a.top+a.height+5<=b.top||b.top+b.height+5<=a.top));
    if(r){placed.set(p.id,r);occupied.push(r);}
  }
  return placed;
}
