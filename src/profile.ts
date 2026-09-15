export const NAME_ERROR='Имя: 1–16 букв, цифр, пробелов, точек или дефисов.';
export const normalizeName=(name:string)=>name.trim().normalize('NFC');
export const validName=(name:string)=>/^[\p{L}\p{N} _.-]{1,16}$/u.test(normalizeName(name));
export class GameProfile {
  name='Рома';skin=0;nameConfirmed=false;
  constructor(private storage:Pick<Storage,'getItem'|'setItem'>|null,private key='roma-online-profile'){
    try{const saved=JSON.parse(storage?.getItem(key)??'null');if(saved){
      if(typeof saved.name==='string'&&validName(saved.name)){this.name=normalizeName(saved.name);this.nameConfirmed=saved.nameConfirmed!==false;}
      if(Number.isInteger(saved.skin)&&saved.skin>=0&&saved.skin<6)this.skin=saved.skin;
    }}catch{}
  }
  select(skin:number){if(!Number.isInteger(skin)||skin<0||skin>5)return;this.skin=skin;this.save();}
  rename(name:string){if(!validName(name))return false;this.name=normalizeName(name);this.nameConfirmed=true;this.save();return true;}
  private save(){try{this.storage?.setItem(this.key,JSON.stringify({name:this.name,skin:this.skin,nameConfirmed:this.nameConfirmed}));}catch{}}
}
