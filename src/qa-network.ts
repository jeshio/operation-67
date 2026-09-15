import { NetworkGame } from './network';
import { emptyInput } from './simulation';
import { mountMultiplayerQA } from './qa-multiplayer';
import { mountCapacityQA } from './qa-capacity';
if(import.meta.env.DEV){
 if(new URLSearchParams(location.search).has('capacity'))mountCapacityQA();else{
 let game:NetworkGame|undefined,previous=performance.now(),accumulator=0,frames=0,fps=0,sample=previous;
 const input=mountMultiplayerQA(()=>{if(game)return;game=new NetworkGame(localStorage,'qa-network-token');game.onRound=()=>game?.releaseInput();game.onConnectionLoss=()=>game?.releaseInput();},()=>game,()=>({fps,rendering:false}));
 const frame=(now:number)=>{accumulator+=Math.min(.1,(now-previous)/1000);previous=now;while(accumulator>=1/60){game?.step(input()??emptyInput());accumulator-=1/60;}game?.render(.016,accumulator*60);frames++;if(now-sample>=1000){fps=frames*1000/(now-sample);sample=now;frames=0;document.querySelector('#state')!.textContent=JSON.stringify(game?.diagnostics(),null,2);}requestAnimationFrame(frame);};requestAnimationFrame(frame);
 }
}
