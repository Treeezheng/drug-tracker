export interface PasswordAssessment { score: 0 | 1 | 2 | 3 | 4; acceptable: boolean; message: string; }
export function assessVaultPassphrase(value: unknown): Promise<PasswordAssessment>;
export function assessAccountPassword(value: unknown, username?: string): Promise<PasswordAssessment>;
export function accountPasswordError(value: unknown, username?: string): Promise<string | null>;
export function vaultPasswordError(value: unknown): Promise<string | null>;
export function masterPasswordError(value: unknown, username?: string): Promise<string | null>;
