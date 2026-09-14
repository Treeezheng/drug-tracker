// Risk wording checked against FDA's prescription stimulant safety communication
// and Ritalin prescribing information, sections 5.1 and 9.3 (2026-09-13).
// https://www.fda.gov/drugs/drug-safety-communications/fda-updating-warnings-improve-safe-use-prescription-stimulants-used-treat-adhd-and-other-conditions
// https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a
import './MedicalDisclaimer.css';

export default function MedicalDisclaimer(){
  return <p className="medical-disclaimer">For personal tracking and simulation only. Curves are simulations, not measured drug levels. This app does not provide medical advice, diagnosis or treatment. Some medications carry risks of addiction or dependence. Do not start, stop or change medication or dosage based on this app; consult your prescribing clinician.</p>;
}
