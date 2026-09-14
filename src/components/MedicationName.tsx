import { medicationBrand, medicationDisplay } from '../lib/medication-display';
import type { ReactNode } from 'react';

export function medicationLabel(id: string, name: string): string {
  return medicationDisplay({id, name}).label;
}

export default function MedicationName({id,name,marker}:{id:string;name:string;marker?:ReactNode}) {
  const display=medicationDisplay({id,name});
  const brand=medicationBrand(id);
  return <span className="medication-name"><span className="medication-title">{display.title}{marker}</span>{brand&&<small className="medication-brand" title="Brand reference">{brand}</small>}</span>;
}
