// Shared browser/server policy. Dictionaries are bundled locally; no password service is contacted.
let estimator;
async function strengthEstimator() {
  estimator ??= Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common'), import('@zxcvbn-ts/language-en')]).then(([core, common, english]) => new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...english.dictionary }, graphs: common.adjacencyGraphs,
    translations: english.translations, maxLength: 256,
  }));
  return estimator;
}
async function assess(value, kind, username) {
  const minimum = kind === 'vault' ? 12 : 15, maximum = kind === 'vault' ? 1024 : 256;
  if (typeof value !== 'string' || (kind === 'master' ? [...value].length : value.length) > maximum || [...value].length < minimum || !value.isWellFormed()) return { score: 0, acceptable: false, message: `Use ${minimum}–${maximum} characters and valid Unicode.` };
  const result = (await strengthEstimator()).check(value, ['Drug Tracker', 'drug-tracker', ...(typeof username === 'string' && username ? [username] : [])]);
  // A few top common-password families must not pass merely by appending a long
  // digit sequence and punctuation. This is a rejection check only: the exact
  // original string still goes to authentication / KDF without normalization.
  const commonVariant = /^(?:password|passw0rd|qwerty|qwertyuiop|letmein|welcome|admin|administrator|drugtracker)[0-9]*$/.test(value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const acceptable = !commonVariant && result.score >= (kind === 'account' ? 3 : 4);
  return { score: result.score, acceptable, message: acceptable ? '' : 'Choose a stronger password: use several unrelated words or a password manager. Avoid common passwords, names, and repeated patterns.' };
}
export function assessVaultPassphrase(value) { return assess(value, 'vault'); }
export function assessAccountPassword(value, username) { return assess(value, 'account', username); }
export async function accountPasswordError(value, username) { const result = await assessAccountPassword(value, username); return result.acceptable ? null : result.message; }
export async function vaultPasswordError(value) { const result = await assessVaultPassphrase(value); return result.acceptable ? null : result.message; }
export async function masterPasswordError(value, username) { const result = await assess(value, 'master', username); return result.acceptable ? null : result.message; }
