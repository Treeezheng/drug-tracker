export const doseRowId=(id:string)=>`dose-row-${id}`;

/** Locate an explicitly added row by identity, independently of its current list index. */
export function focusDoseRow(document:Document,id:string):boolean {
  const row=document.getElementById(doseRowId(id));
  const control=row?.querySelector<HTMLSelectElement>('.medication-field select');
  if(!row?.isConnected||!control||control.disabled)return false;
  // A closing picker must release its modal focus trap before the new row takes focus.
  if(document.querySelector('dialog[open]'))return false;
  control.focus({preventScroll:true});
  const reduced=document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches??true;
  control.scrollIntoView({block:'center',inline:'nearest',behavior:reduced?'instant':'smooth'});
  return true;
}
