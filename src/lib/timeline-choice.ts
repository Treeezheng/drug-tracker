import { products } from './catalog';
import { medicationBrand, medicationDisplay } from './medication-display';
import { includeTimelineDose } from './model';
import type { Dose } from './types';

export interface TimelineChoice {id:string;label:string;doses:Dose[];}

/** Repeated doses of one formulation share a view; different medications are switched. */
export function timelineChoices(doses:readonly Dose[]):TimelineChoice[] {
  const choices=new Map<string,TimelineChoice>(),labels=new Map<string,Set<string>>();
  for(const dose of doses.filter(includeTimelineDose)){
    const product=products.find(item=>item.id===dose.productId);
    const id=medicationDisplay({id:dose.productId,name:product?.name??dose.productName}).groupId;
    const name=medicationBrand(dose.productId)??medicationDisplay({id:dose.productId,name:dose.productName}).title;
    const choice=choices.get(id)??{id,label:'',doses:[]};
    const names=labels.get(id)??new Set<string>();names.add(name);labels.set(id,names);
    choice.doses.push(dose);choice.label=[...names].join(' / ');choices.set(id,choice);
  }
  return [...choices.values()];
}

export function selectedTimelineChoice(choices:readonly TimelineChoice[],id:string|null) {
  return choices.find(choice=>choice.id===id)??choices[0];
}
