import { products } from './catalog';
import { CONCERTA_TRACE, MODEL_VERSION, modelGroup, pkReferenceForDose, referenceForDose, RITALIN_REFERENCE, validIllustrationParameters } from './model';
import type { Dose } from './types';

export interface DoseFormulaDescription {
  kind:'reference'|'reference-illustration'|'saved-illustration'|'unavailable';
  title:string;
  equations:string[];
  parameters:string[];
  note:string;
}
/** Explain the implemented concentration function; never create or accept assumptions. */
export function describeDoseFormula(dose:Dose):DoseFormulaDescription {
  const unavailable=(note='No verified formula is implemented for this entry.'):DoseFormulaDescription=>({kind:'unavailable',title:'Formula unavailable',equations:[],parameters:[],note});
  if(dose.modelVersion&&dose.modelVersion!==MODEL_VERSION)return unavailable('The formula for this saved model version is unavailable.');
  const product=products.find(item=>item.id===dose.productId);
  if(!product)return unavailable();
  if(!Number.isFinite(Number(dose.amountMg))||Number(dose.amountMg)<=0)return unavailable('Complete the strength and quantity to show a formula.');
  const pkReference=pkReferenceForDose(dose);
  if(pkReference)return {
    kind:'reference-illustration',title:`${pkReference.label} · estimated reference`,
    equations:[pkReference.packageReference
      ?`C(t) = ${pkReference.doseScale} × Cref(t); ${dose.quantity} capsule(s) of ${dose.packageStrength} mg, referenced to ${pkReference.packageReference.strength} mg`
      :`C(t) = (${dose.amountMg} / ${pkReference.referenceDoseMg} mg) × Cref(t)`,...new Set(pkReference.channels.map(channel=>channel.points
      ?'Cref(t): linear interpolation between the listed reference landmarks; after the last point, exponential continuation with the listed half-life.'
      :'Cref(t) = Cmax × (exp(−kₑu) − exp(−kₐu)) / (exp(−kₑtp) − exp(−kₐtp)); kₑ = ln(2) / half-life, u = t − lag, and kₐ is fitted to tp.'))],
    parameters:pkReference.channels.flatMap(channel=>[`${channel.group}: Cmax ${channel.cmax} ng/mL; peak ${channel.peakHours} h; half-life ${channel.halfLifeHours} h${channel.lagHours?`; lag ${channel.lagHours} h`:''}`,...(channel.points?[`Reference landmarks (h, ng/mL): ${channel.points.map(point=>`(${point.join(', ')})`).join(', ')}`]:[])]),
    note:`${pkReference.population}. ${pkReference.note} Time is hours since administration; the curve and dose scaling are estimates, not personal measurements or a prediction of effect. Distinct analytes are kept separate.`,
  };
  if(!modelGroup(dose).reference){
    const reference=referenceForDose(dose);
    if(reference){
      const r=RITALIN_REFERENCE;
      return {kind:'reference-illustration',title:'Reference simulation · unvalidated',
        equations:[`Cillustration(t) = (D / ${reference.referenceDoseMg} mg) × Cref(t)`,reference.referenceProductId==='ritalin'?`Cref(t) = ${r.amplitude} × (exp(−kₑt) − exp(−kₐt)) / (exp(−${r.peakHours}kₑ) − exp(−${r.peakHours}kₐ))`:'Cref(t) = Cᵢ + (Cᵢ₊₁ − Cᵢ) × (t − tᵢ) / (tᵢ₊₁ − tᵢ)'],
        parameters:[`D = ${dose.amountMg} mg · scale = ${reference.doseScale}`,reference.referenceProductId==='ritalin'?`kₑ = ln(2) / ${r.halfLifeHours} h⁻¹ · kₐ = ${r.absorptionRate} h⁻¹`:'After 29.976 h: estimated continuation with a 3.5 h half-life, when shown.'],
        note:`${reference.reason} t is hours since administration; the reference axis is ng/mL, not a measured or predicted personal concentration.`};
    }
    const a=dose.assumptions;
    if(!validIllustrationParameters(a))return unavailable();
    return {
      kind:'saved-illustration',title:'Saved illustration · unvalidated',
      equations:['u = t − L','y(t) = 0, when u < 0','y(t) = A × (D / Dref) × (u / tp), when 0 ≤ u < tp','y(t) = A × (D / Dref) × 2^(−(u − tp) / h), when u ≥ tp'],
      parameters:[`L = ${a.lagHours} h · tp = ${a.peakHours} h · h = ${a.halfLifeHours} h`,`A = ${a.amplitude} relative units · D / Dref = ${dose.amountMg} / ${a.referenceDose}`],
      note:'Saved arbitrary shape; not a verified medication or concentration model. t is hours since administration; y is in relative units.',
    };
  }
  if(product.model==='ritalin'){
    const r=RITALIN_REFERENCE;
    return {
      kind:'reference',title:'Constructed reference · B',
      equations:[`C(t) = ${r.amplitude} × (exp(−kₑt) − exp(−kₐt)) / (exp(−${r.peakHours}kₑ) − exp(−${r.peakHours}kₐ))`],
      parameters:[`kₑ = ln(2) / ${r.halfLifeHours} h⁻¹ · kₐ = ${r.absorptionRate} h⁻¹`],
      note:'t is hours since administration; C is ng/mL. Adult 10 mg reference estimate, not a personal measurement.',
    };
  }
  const [lastT]=CONCERTA_TRACE[CONCERTA_TRACE.length-1];
  return {
    kind:'reference',title:'Reference profile · A; estimated continuation · B',
    equations:['C(t) = Cᵢ + (Cᵢ₊₁ − Cᵢ) × (t − tᵢ) / (tᵢ₊₁ − tᵢ)',`After ${lastT} h, when shown: C(t) = C(${lastT}) × 2^(−(t − ${lastT}) / 3.5)`],
    parameters:[`Observed reference interpolation: 0 ≤ t ≤ ${lastT} h. Beyond that, the displayed continuation uses an estimated 3.5 h half-life and is starred.`],
    note:'t is hours since administration; C is ng/mL. Adult 18 mg group profile with an unobserved estimated continuation, not a personal measurement. Published-only views omit the continuation.',
  };
}
