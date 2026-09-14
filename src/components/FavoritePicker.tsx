import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { products } from '../lib/catalog';
import { commitFavoriteChanges, favoriteChanges, favoriteSelection } from '../lib/favorite-selection';
import { groupMedicationProducts, matchesMedicationGroup, type MedicationGroup } from '../lib/medication-display';
import { groupStrengthSelected, groupStrengths, selectGroupStrength, selectedGroupCount } from '../lib/grouped-favorite-selection';
import { parseCustomStrength } from '../lib/package-strength';
import type { FavoriteChange } from '../lib/favorite-selection';
import type { Favorite } from '../lib/types';
import Modal from './Modal';

export default function FavoritePicker({ favorites, onSave, onRemove, onClose }: {
  favorites: Favorite[];
  onSave: (favorite: Favorite) => Promise<void> | void;
  onRemove: (favorite: Favorite) => Promise<void> | void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState(() => favoriteSelection(favorites));
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [custom, setCustom] = useState<string | null>(null), [customValue, setCustomValue] = useState(''), [customError, setCustomError] = useState('');
  const container = useRef<HTMLDivElement>(null), inFlight = useRef(false), pending = useRef<FavoriteChange[] | null>(null);
  const hintId = useId();
  const needle = query.trim().toLocaleLowerCase();
  const grouped = groupMedicationProducts(products).filter(group => matchesMedicationGroup(group, needle));
  const selectedCount = selectedGroupCount(selection);
  const families = [...new Set(grouped.map(group => group.family))];
  const unknown = favorites.filter(favorite => !products.some(product => product.id === favorite.productId));

  useEffect(() => {
    const dialog = container.current?.closest('dialog');
    // Modal's default Esc action also needs preventing while a save is in flight.
    const cancel = (event: Event) => { if (inFlight.current) event.preventDefault(); };
    dialog?.addEventListener('cancel', cancel);
    return () => dialog?.removeEventListener('cancel', cancel);
  }, []);

  function close() { if (!inFlight.current) onClose(); }
  function toggle(group: MedicationGroup, strength: string, checked: boolean) {
    if (inFlight.current) return;
    pending.current = null;
    setError('');
    setSelection(current => selectGroupStrength(current, favorites, group, strength, checked));
  }
  function addCustom(group: MedicationGroup) {
    if (inFlight.current) return;
    try {
      const strength = parseCustomStrength(group.defaultProduct, customValue);
      toggle(group, strength, true);
      setCustom(null); setCustomValue(''); setCustomError('');
    } catch (reason) { setCustomError(reason instanceof Error ? reason.message : 'Enter a valid strength.'); }
  }
  async function save() {
    if (inFlight.current) return;
    let nextSelection = selection;
    if (custom && customValue.trim()) {
      const group = groupMedicationProducts(products).find(group => group.id === custom)!;
      try {
        nextSelection = selectGroupStrength(selection, favorites, group, parseCustomStrength(group.defaultProduct, customValue), true);
        setSelection(nextSelection); pending.current = null;
        setCustom(null); setCustomValue(''); setCustomError('');
      } catch (reason) { setCustomError(reason instanceof Error ? reason.message : 'Enter a valid strength.'); return; }
    }
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      pending.current ??= favoriteChanges(favorites, nextSelection);
      await commitFavoriteChanges(pending.current, onSave, onRemove);
      onClose();
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : 'Could not save your selection.'} Your selection is kept. Retry to finish saving.`);
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <Modal title="Choose medications" wide onClose={close}>
    <div className="favorite-picker" ref={container} aria-busy={busy}>
      <label className="search-input fp-search"><Search size={16} aria-hidden="true"/><input aria-label="Search brand or ingredient" placeholder="Search brand or ingredient" value={query} onChange={event => setQuery(event.target.value)} disabled={busy}/></label>
      <p className="fp-hint" id={hintId}>Choose one or more strengths.</p>
      <fieldset className="fp-catalog" disabled={busy} aria-describedby={hintId}>
        <legend className="sr-only">Medication strengths</legend>
        {families.map(family => <section className="fp-family" key={family}>
          <h3>{family}</h3>
          {grouped.filter(group => group.family === family).map(group => <section className="fp-product-group" key={group.id}>
            <div className="fp-name"><h4>{group.title}</h4>{group.brand && <small className="fp-brand">{group.brand}</small>}</div>
            <fieldset className="fp-product">
              <legend className="sr-only">{group.title} strengths</legend>
              {!group.brand && <p className="fp-formulation">{group.defaultProduct.formulation}</p>}
              <div className="fp-strengths">{groupStrengths(group, favorites, selection).map(strength => {
                const checked = groupStrengthSelected(selection, group, strength);
                return <label className={`fp-strength${checked ? ' is-selected' : ''}`} key={strength}>
                  <input type="checkbox" aria-label={`${group.title} ${strength} ${group.defaultProduct.strengthUnit}`} checked={checked} onChange={event => toggle(group, strength, event.currentTarget.checked)}/>
                  <span>{strength} <span className="fp-unit">{group.defaultProduct.strengthUnit}</span></span>
                </label>;
              })}<button className="fp-strength fp-custom-toggle" type="button" aria-label={`Custom strength for ${group.title}`} aria-expanded={custom === group.id} onClick={() => {
                setCustom(current => current === group.id ? null : group.id); setCustomValue(''); setCustomError('');
              }}>Custom</button></div>
              {custom === group.id && <div className="fp-custom">
                <label>Strength · {group.defaultProduct.strengthUnit}<input autoFocus aria-label={`${group.title} custom strength`} aria-invalid={Boolean(customError)} aria-describedby={customError ? `${hintId}-custom-error` : undefined} inputMode={group.defaultProduct.strengths[0].includes('/') ? 'text' : 'decimal'} placeholder={group.defaultProduct.strengths[0].includes('/') ? group.defaultProduct.strengths[0] : 'e.g. 7.5'} value={customValue} onChange={event => { setCustomValue(event.target.value); setCustomError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustom(group); } }}/></label>
                <button className="button secondary" type="button" onClick={() => addCustom(group)}>Add</button>
                {customError && <p className="inline-error" id={`${hintId}-custom-error`} role="alert">{customError}</p>}
              </div>}
            </fieldset>
          </section>)}
        </section>)}
        {!grouped.length && <p className="fp-empty" role="status">No matching medications.</p>}
        {!needle && unknown.length > 0 && <section className="fp-family"><h3>Other saved medications</h3>{unknown.map(favorite => {
          const [key] = favoriteSelection([favorite]).keys();
          return <label className="fp-saved" key={favorite.id}><input type="checkbox" checked={selection.has(key)} onChange={event => {
            const checked = event.currentTarget.checked;
            pending.current = null; setError('');
            setSelection(current => { const next = new Map(current); if (checked) next.set(key, favorite); else next.delete(key); return next; });
          }}/><span>{favorite.productId} · {favorite.packageStrength || favorite.strength}</span></label>;
        })}</section>}
      </fieldset>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="fp-footer modal-footer">
        <span className="muted" role="status">{selectedCount} {selectedCount === 1 ? 'strength' : 'strengths'} selected</span>
        <button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save selection'}</button>
      </div>
    </div>
  </Modal>;
}
