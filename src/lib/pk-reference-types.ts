/** Source-backed population parameters, not personal concentration predictions. */
export interface PkReferenceChannel {
  group: string;
  peakHours: number;
  cmax: number;
  halfLifeHours: number;
  lagHours?: number;
  /** Source landmarks or explicitly constructed estimates; linear interpolation and a tail. */
  points?: readonly (readonly [number, number])[];
}

export interface PkReferenceProfile {
  id: string;
  productIds: readonly string[];
  label: string;
  referenceDoseMg: number;
  /** Fixed combination packages use explicit ratios, never a sum of ingredient masses. */
  packageReference?: { strength: string; scales: Readonly<Record<string, number>> };
  unit: string;
  strengthUnit: string;
  channels: readonly PkReferenceChannel[];
  sourceIds: readonly string[];
  population: string;
  note: string;
  /** Whether labeled tablet quantities may be represented in half-tablet steps. */
  fractionalTablets?: boolean;
  /** Only these labeled package strengths support half-tablet quantities. */
  fractionalStrengths?: readonly string[];
}
