import { doseInputError } from '../components/DoseEditor';
import { doseTimestamp } from './model';
import type { Dose } from './types';

/** Collapse a valid simulation locally; never change the dose or create an account record. */
export function submitGuestDose(dose:Dose, submitted:ReadonlySet<string>):Set<string> {
  if(dose.status!=='simulated')throw new Error('Only simulated doses belong in this guest workspace.');
  const issue=doseInputError(dose);
  if(issue)throw new Error(issue);
  if(!Number.isFinite(doseTimestamp(dose)))throw new Error('Choose a complete, valid date and time first.');
  return new Set([...submitted,dose.id]);
}
