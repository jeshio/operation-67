import { GameProfile, NAME_ERROR } from './profile';
import type { JoinRequest } from './protocol';
export type JoinIntent=Pick<JoinRequest,'mode'|'code'>;
/** The same name gate is used by quick entry, room creation and invitations. */
export class JoinFlow {
  stage:'friends'|'name'|'connecting'|'error'='friends';
  error='';intent?:JoinIntent;private startedAt=0;
  constructor(private profile:GameProfile,private send:(request:JoinRequest)=>void,private abort:()=>void,private now=()=>performance.now()){}
  request(intent:JoinIntent){
    if(this.stage==='connecting')return;
    this.intent={...intent};this.error='';
    if(!this.profile.nameConfirmed){this.stage='name';return;}
    this.begin();
  }
  confirm(name:string){
    if(this.stage!=='name')return;
    if(!this.profile.rename(name)){this.error=NAME_ERROR;return;}
    this.begin();
  }
  private begin(){
    if(!this.intent)return;
    this.stage='connecting';this.error='';this.startedAt=this.now();
    this.send({type:'join',...this.intent,name:this.profile.name,skin:this.profile.skin});
  }
  retry(){if(this.stage==='error'&&this.intent)this.request(this.intent);}
  observe(room:unknown,error:string){
    if(this.stage!=='connecting')return;
    if(room){this.stage='friends';return;}
    if(error||this.now()-this.startedAt>=12000){
      this.error=error||'Не удалось связаться с сервером. Проверь интернет и попробуй ещё раз.';
      this.stage='error';this.abort();
    }
  }
  back(){this.stage='friends';this.error='';}
}
