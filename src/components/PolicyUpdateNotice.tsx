import { useState } from 'react';
import { X } from 'lucide-react';

// Dismissal lasts only in this page's memory; no extra device storage or consent.
let dismissed = false;
export default function PolicyUpdateNotice() {
  const [visible, setVisible] = useState(!dismissed);
  if (!visible) return null;
  return <aside className="policy-update" aria-label="Privacy and security update">
    <p>Privacy &amp; security updated September 13, 2026. Review our <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noreferrer">Privacy policy</a> and <a href={`${import.meta.env.BASE_URL}terms.html`} target="_blank" rel="noreferrer">Terms</a>.</p>
    <button className="icon-button" aria-label="Dismiss policy update" onClick={() => { dismissed = true; setVisible(false); }}><X size={16}/></button>
  </aside>;
}
