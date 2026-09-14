import { describeDoseFormula } from '../lib/model-formula';
import type { Dose } from '../lib/types';

export default function DoseFormula({dose}:{dose:Dose}){
  const formula=describeDoseFormula(dose);
  return <div className="dose-formula-content" data-formula-kind={formula.kind}>
    {formula.kind!=='unavailable'&&<p className="dose-formula-title">{formula.title}</p>}
    {formula.equations.map(equation=><p className="dose-equation" key={equation}>{equation}</p>)}
    {formula.parameters.map(parameter=><p key={parameter}>{parameter}</p>)}
    <p>{formula.note}</p>
  </div>;
}
