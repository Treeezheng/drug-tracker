import { products } from './catalog';
import { pkProfileForProduct } from './pk-references';

export const RECORDING_ONLY_LABEL = 'Recording only';
export const RECORDING_ONLY_EXPLANATION = 'Recording only: dose times can be recorded, but no concentration curve is available.';

/** Product-level availability only; each recorded dose still needs model validation. */
export function isRecordingOnlyMedication(productId: string): boolean {
  if (!productId) return false;
  const product = products.find(item => item.id === productId);
  if (!product) return true;
  // The generic IR tablet has an explicit Ritalin overlay in referenceForDose.
  // Evidence D alone does not exclude that overlay or the PK reference registry.
  return product.model !== 'concerta' && product.model !== 'ritalin'
    && productId !== 'methylphenidate-ir' && !pkProfileForProduct(productId);
}
