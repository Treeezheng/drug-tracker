import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { products } from '../lib/catalog';
import { commitFavoriteChanges, favoriteChanges, favoriteSelection, favoriteStrengths, selectFavoriteStrength, strengthKey } from '../lib/favorite-selection';
import { groupMedicationProducts, medicationDisplay } from '../lib/medication-display';
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
  const container = useRef<HTMLDivElement>(null), inFlight = useRef(false), pending = useRef<FavoriteChange[] | null>(null);
  const hintId = useId();
  const needle = query.trim().toLocaleLowerCase();
  const filtered = products.filter(product => {
    const display = medicationDisplay(product);
    return `${product.name} ${product.generic} ${product.formulation} ${display.title} ${display.variant || ''}`.toLocaleLowerCase().includes(needle);
  });
  const grouped = groupMedicationProducts(filtered);
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
  function toggle(productId: string, strength: string, checked: boolean) {
    if (inFlight.current) return;
    pending.current = null;
    setError('');
    setSelection(current => selectFavoriteStrength(current, favorites, productId, strength, checked));
  }
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError('');
    try {
      pending.current ??= favoriteChanges(favorites, selection);
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
            <h4>{group.title}</h4>
            {group.products.map(product => {
              const display = medicationDisplay(product);
              return <fieldset className="fp-product" key={product.id}>
                <legend className={display.variant ? 'fp-variant' : 'sr-only'}>{display.variant || display.label}</legend>
                {!display.variant && <p className="fp-formulation">{product.formulation}</p>}
                <div className="fp-strengths">{favoriteStrengths(product, favorites).map(strength => {
                  const checked = selection.has(strengthKey(product.id, strength));
                  return <label className={`fp-strength${checked ? ' is-selected' : ''}`} key={strength}>
                    <input type="checkbox" aria-label={`${display.label} ${strength} ${product.strengthUnit}`} checked={checked} onChange={event => toggle(product.id, strength, event.currentTarget.checked)}/>
                    <span>{strength} <span className="fp-unit">{product.strengthUnit}</span></span>
                  </label>;
                })}</div>
              </fieldset>;
            })}
          </section>)}
        </section>)}
        {!filtered.length && <p className="fp-empty" role="status">No matching medications.</p>}
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
        <span className="muted" role="status">{selection.size} {selection.size === 1 ? 'strength' : 'strengths'} selected</span>
        <button className="button secondary" disabled={busy} onClick={close}>Cancel</button>
        <button className="button primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save selection'}</button>
      </div>
    </div>
  </Modal>;
}
