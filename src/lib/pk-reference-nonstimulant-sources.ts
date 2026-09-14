import type { Source } from './types';

export const NONSTIMULANT_PK_SOURCES: Source[] = [
  {
    id: 'N1', title: 'FDA Strattera clinical pharmacology review — single-dose LYAL study',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2002/21-411_Strattera_biopharmr_P2.pdf',
    section: 'Pages 92–93, B4Z-LC-LYAL, Table 1 (arithmetic means)', reviewed: '2026-09-14',
    note: 'Single 40 mg market-image capsule, fasted, CYP2D6 extensive-metabolizer healthy adults. N=24: Cmax 333 ng/mL, median Tmax 1 h, half-life 4.2 h, AUC∞ 2.11 µg·h/mL. Do not substitute the next study (60 mg LYAZ), geometric means, fed arm, or a poor-metabolizer profile.',
  },
  {
    id: 'N2', title: 'FDA Intuniv clinical review — adult single-dose ER pharmacokinetics',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2009/022037s000medr.pdf',
    section: 'Table 5.1, single-dose guanfacine IR versus ER in adults', reviewed: '2026-09-14',
    note: 'Fasted single 1 mg ER tablet, N=52: Cmax 0.98 ng/mL, median Tmax 6 h, half-life 17.5 h, AUC∞ 32.4 ng·h/mL, C24 0.53 ng/mL. This review explicitly establishes single-dose conditions; it is not the IR Tenex arm or a steady-state trace.',
  },
  {
    id: 'N3', title: 'FDA Qelbree integrated review — single-dose viloxazine ER',
    url: 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2021/211964Orig1s000IntegratedR.pdf',
    section: 'Page 206, Study 812P103, Table 139 (day 1 single-dose results)', reviewed: '2026-09-14',
    note: 'Fasted healthy adults, 200 mg SPN-812 ER: Cmax 1.33 µg/mL, median Tmax 5 h, half-life 7.02 h, AUC∞ 27.3 h·µg/mL; N=28, with N=27 for half-life/AUC∞. Convert µg to ng by ×1000. Tables 140–141 describe subsequent repeated dosing and are not single-dose inputs. The constructed curve underestimates mean AUC by about 19.2%.',
  },
];
