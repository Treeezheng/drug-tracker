import { medicationDisplay } from '../lib/medication-display';

export function medicationLabel(id: string, name: string): string {
  return medicationDisplay({id, name}).label;
}

export default function MedicationName({id,name}:{id:string;name:string}) {
  const display=medicationDisplay({id,name});
  return <span className="medication-name"><span className="medication-title">{display.title}</span>{display.variant&&<small className="medication-brand">{display.variant}</small>}</span>;
}
