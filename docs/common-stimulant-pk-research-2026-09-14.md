# Common stimulant reference constructions — 2026-09-14

Scope: seven adult, fasted, single-dose reference profiles covering nine existing catalog IDs. These are **starred estimates**, not measured personal concentrations, clinical validation, treatment advice, or certification. Source facts and application-fitted quantities are distinguished below. Registration and application integration are owned by the main implementation task.

The data live in `src/lib/pk-reference-common-stimulants.ts`; source metadata F1–F8 live in `src/lib/pk-reference-common-stimulant-sources.ts`. The sources are primary FDA clinical pharmacology reviews and FDA/DailyMed labels. No clinical trial participant records or user health data were used.

## Exact reference conditions

All Cmax values are ng/mL, times are hours, and AUC values are ng·h/mL. Slash-separated values in the amphetamine rows mean separate **d / l analytes**, never their sum. N is the pharmacokinetic arm count, not necessarily the randomized count. Mean Tmax is used unless explicitly marked median.

| Catalog IDs | Administered reference and population | Analyte | Cmax | Tmax | Terminal half-life | AUC∞ | Sources |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `focalin`, `dexmethylphenidate-ir` | Two 10 mg HCl tablets once; 15 healthy fasted adults, PK-00-001 | d-Methylphenidate | 23.7 | 1.5 | 2.7 | 120.9 | F1, F2 |
| `focalin-xr`, `dexmethylphenidate-er` | One 20 mg HCl capsule; 24 healthy fasted adults, study 2101 | d-Methylphenidate | First 13.5; second 14.9 | First 1.5; second 6.5 | 3.26 | 119.1 | F2 |
| `dyanavel-xr-tablet` | One 20 mg amphetamine-base tablet swallowed whole; 32 healthy fasted adults | d / l Amphetamine | 53.4 / 17.2 | 5 / 5, median | 13.5 / 17.3, label summaries | 1215 / 481 | F3, F4 |
| `mydayis` | One 37.5 mg mixed-salt capsule; 20 healthy fasted adults, age 19–52 | d / l Amphetamine | 50.3 / 14.7 | 8.2 / 8.4 | 10.1 / 12.5 | 1085 / 373 | F5, F6 |
| `evekeo` | Two 10 mg racemic sulfate IR tablets with water; 39 healthy fasted adults, AR17.001 C | d / l Amphetamine | 29.4 / 24.8 | 2.51 / 2.72 | 10.1 / 11.6 | 493 / 488 | F7 |
| `evekeo-odt` | One 20 mg racemic sulfate ODT without water; 40 healthy fasted adults, AR17.001 B | d / l Amphetamine | 29.4 / 24.8 | 3.28 / 3.45 | 10 / 11.8 | 506 / 505 | F7 |
| `dyanavel-xr-liquid` | 7.5 mL × 2.5 mg base/mL = **18.75 mg**; 29 healthy fasted adults, 2014-3401 A | d / l Amphetamine | 54.128 / 17.286 | 4 / 4, median | 12.36 / 15.12 | 1197.321 / 461.544 | F8 |

Focalin XR first/second peaks and trough are FDA reviewer calculations from Table 19. Sponsor Table 20 has slightly different peak summaries and supplies the AUC/half-life values. The same treatment is being described; the application does not claim these summary statistics form an exact observed mean trace. The 7.6 ng/mL trough at 4 h retains the characteristic two-peak XR shape.

The Dyanavel suspension review rounds 18.75 mg to 18.8 mg. Its “20 mg/8 mL” wording describes the formulation concentration, not a 20 mg administration. The reference denominator is therefore 18.75 mg; the recorded unit remains mL with mg/mL strength. The tablet reference has its own study and is not substituted for this suspension.

## Constructed curves and exposure checks

The checked evaluator is `evaluatePkReference`. Point-based profiles use linear interpolation and a terminal exponential continuation after the last anchor. Focalin IR uses a normalized Bateman shape with the reported peak and terminal half-life. The fitted lag is **0.44935035 h**, not a measured physiological delay. A no-lag curve would produce AUC ≈135.68 rather than 120.9; matching total exposure corrects that inconsistency.

The remaining profiles are explicit hybrid constructions: product-specific figure readings plus reported peak summaries. The mean of individual peaks and the peak of a mean curve are different quantities. These constructions should not be described as digitized full curves or reproduced study measurements. For Dyanavel tablets, no full-curve reconstruction is claimed: the two-hour points, 38.36 / 11.68, are algebraically fitted to AUC0–5, then the label half-lives define the tails.

Synthetic evaluation used 0.001-hour trapezoids through 240 h. The tiny unintegrated tails do not change the displayed figures materially. Units, product IDs, reported peak values, nonnegative/finite outputs, negative-time zero, and nonfinite-time rejection all passed for seven profiles, nine products, and twelve analyte channels.

| Reference | Calculated AUC through 240 h | Reported AUC∞ | Relative difference |
| --- | --- | --- | --- |
| Focalin IR | 120.900 | 120.9 | <0.001% |
| Focalin XR | 118.391 | 119.1 | −0.60% |
| Dyanavel tablet d / l | 1216.033 / 484.253 | 1215 / 481 | +0.09% / +0.68% |
| Mydayis d / l | 1085.911 / 373.103 | 1085 / 373 | +0.08% / +0.03% |
| Evekeo IR d / l | 494.734 / 489.618 | 493 / 488 | +0.35% / +0.33% |
| Evekeo ODT d / l | 502.543 / 504.937 | 506 / 505 | −0.68% / −0.01% |
| Dyanavel suspension d / l | 1204.396 / 465.209 | 1197.321 / 461.544 | +0.59% / +0.79% |

Matching an AUC used for fitting is calibration, **not independent validation**. Additional early-phase checks limit obviously wrong release shapes:

- Focalin IR scaled to 10 mg gives AUC0–4 = 33.210 versus **32.5** in the separate study 2101 IR arm: +2.18%. This is an independent cross-study comparison, not proof of individual equivalence.
- Focalin XR gives AUC0–4 = **35.35** versus 36.3 (−2.62%), and AUC4–10 = **61.10** versus 59.1 (+3.38%). Rise/decline anchors come from its own Figure 3.
- Dyanavel tablets give AUC0–5 = **176 / 55**, matching the quantities used to fit the two-hour anchors. No independent sub-five-hour shape validation is claimed.
- Mydayis early anchors follow **Mydayis circle markers** in label Figure 1. The separate square-marker MAS-ER plus later MAS-IR regimen is excluded. AUC0–4 = 84.65 / 23.45 is an application result; there is no claimed reported partial-AUC comparator.
- Evekeo IR and ODT use their **own C and B figure traces**, respectively; no Adderall kernel is borrowed. Their AUC0–4 values are 86.748 / 72.675 and 75.480 / 62.763. These are application results, not reported partial AUCs.
- Dyanavel suspension gives AUC0–4 = **144.624 / 45.543** versus 143.813 / 45.013, and AUC0–5 = **197.443 / 62.536** versus 195.695 / 61.642: differences about 0.56–1.45%. Early d anchors agree with FDA's single-dose input values in its superposition appendix; tail anchors remain coarse readings of the treatment-A graph. Appendix simulation table columns are not treated as independent measured late-time data.

## Source inventory and verification

- **F1:** [FDA Focalin IR medical review containing clinical pharmacology](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2001/21-278_Focalin_medr_P1.pdf), study PK-00-001, Table 2-2 printed p. 26/51 and Table 3-5 p. 39. Primary indexed text verified. This particular PDF could not be downloaded for visual table verification in this environment. Fed values, the pooled label half-life, and inactive d-ritalinic-acid values are not used.
- **F2:** [FDA Focalin XR clinical pharmacology review](https://www.fda.gov/media/80207/download), Figure 3 and Tables 19–20, printed pp. 29, 32–33/140; PDF pp. 23–25. Figures/tables visually checked. The review reports an assay quality-control caveat for one run; the affected samples could not be identified. This further limits precision.
- **F3:** [FDA Dyanavel XR tablet multidisciplinary review](https://www.fda.gov/media/155563/download), Tables 1–4 pp. 31–34. Table 4 whole-tablet column visually checked on p. 33; l-AUC continuation checked on p. 34. The accessed FDA mirror has different PDF pagination from the NDA archive copy. Chewed, fed, and suspension rows remain separate.
- **F4:** [DailyMed Dyanavel XR label](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=ae304b29-0b40-40ec-ad0d-76b742d4a9b9), §12.3. Tablet half-life summaries are used with their provenance disclosed; they are not falsely claimed to be exact estimates from only the Table 4 whole-tablet arm.
- **F5:** [FDA Mydayis review](https://www.fda.gov/media/132150/download?attachment=), Table 2 p. 15 adult single-dose row. Visually checked; pediatric and repeated-dose rows excluded.
- **F6:** [FDA Mydayis label](https://www.fda.gov/media/142062/download?attachment=), §12.3 Figure 1 p. 15. Visually checked. Approximate circle-marker readings are application-created anchors.
- **F7:** [FDA Evekeo ODT clinical pharmacology review](https://www.fda.gov/media/148768/download), Figures 1–2 pp. 8–9, adult study design pp. 14–16, arithmetic-mean PK tables pp. 20/22. Visually checked. Adjacent geometric means and AUClast are not mistaken for arithmetic means and AUC∞; sampling Tlast varies by analyte.
- **F8:** [FDA Dyanavel suspension clinical pharmacology review](https://www.fda.gov/media/95789/download), exact administered volume p. 45; treatment-A curves and PK tables pp. 49–52; partial-AUC Tables 5/7 printed pp. 18–19; FDA simulation appendix pp. 66–67. Dose description, curves, and parameter tables visually checked.

## Boundary conditions and remaining limits

Focalin and Evekeo doses retain labeled HCl and total sulfate salt masses, respectively; Mydayis retains mixed-salt mg; Dyanavel retains amphetamine-base mg. There is no automatic salt/base conversion, no d/l addition, and no use of total racemic concentrations as d-only values. Brand-to-unspecified-generic transfer is explicitly an unvalidated illustration.

Only Focalin IR and conventional Evekeo IR opt into half-tablet quantity estimates. XR capsules, XR tablets, and ODT quantities remain whole in these profiles. The Dyanavel liquid retains fractional mL support. Other-dose scaling is illustrative, even where source labels describe proportional exposure across some studied doses; none of these adult references supplies pediatric, fed, interaction, renal-impairment, or individual variability modeling.

All seven requested formulations are supported by this data set, including **Evekeo IR, Evekeo ODT, and Dyanavel suspension**; they are not left as gaps. Azstarys is a separate research/integration task because its two-ingredient package and prodrug require their own model. Other catalog products are not silently mapped to one of these formulations. This document records bounded source and numerical checks, not an independent audit of all application security or a clinical certification.
