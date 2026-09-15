import { MODULES, type ModuleId } from './modules';
export function moduleList(element:HTMLElement,ids:ModuleId[]){
  const key=ids.join(',');if(element.dataset.modules===key)return;element.dataset.modules=key;
  element.querySelector('summary')!.textContent=`Установленные модули · ${ids.length}`;
  const items=ids.map(id=>{const li=document.createElement('li');const name=document.createElement('b'),effect=document.createElement('span');li.style.borderLeft=`3px solid ${MODULES[id].labelBg}`;li.style.paddingLeft='9px';name.textContent=MODULES[id].name;effect.textContent=MODULES[id].effect;li.append(name,effect);return li;});
  if(!items.length){const li=document.createElement('li');li.textContent='Победи большого босса и выбери улучшение';items.push(li);}
  element.querySelector('ul')!.replaceChildren(...items);
}
