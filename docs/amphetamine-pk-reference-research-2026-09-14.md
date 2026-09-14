# Amphetamine reference curves: source review and implementation limits

Reviewed 2026-09-14. This is a bounded source and implementation crosscheck, not clinical validation or certification. Numerical data below are population summaries; the application curves are constructed illustrations, not measured personal levels or predictions of clinical benefit.

## Why most catalog entries had no curve

At the start of this review, the catalog contained 50 products. Only Ritalin and Concerta had direct model enums. The reference-overlay allowlist additionally accepted generic methylphenidate IR. The remaining products defaulted to `model: assumption`, but new doses had no accepted assumptions and the current editor offered no way to enter them. `concentration()` therefore returned unknown after administration and the chart showed a timing event. Ordinary half-tablet quantities also failed the old integer-quantity reference eligibility checks.

The broad fix is a formulation-specific reference registry with explicit source IDs, dose basis, units, analytes, eligibility and uncertainty. It must preserve unknown concentrations and legacy relative-unit assumptions. A catalog label alone is not a numerical concentration model. Parent lisdexamfetamine, active dextroamphetamine, l-amphetamine, racemic methylphenidate and dexmethylphenidate must not become one numerical total.

## Mixed amphetamine salts IR: directly supported reference

The [FDA 2002 Adderall IR clinical pharmacology review](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2002/11-522s030_adderall_biopharmr.pdf) contains the original results in review Tables 6–8 (printed p. 8), Table 13 (p. 11), study synopses (pp. 13–19), and Table 14 (p. 21). New and marketed tablets were compared in separate single-dose crossover studies at 10 and 30 mg after an overnight fast. Study 371.102 enrolled 18 healthy adults; 17 completed. Inclusion age was 19–55 years. Samples were collected through 60 hours, including half-hour intervals around the early peak. Study 371.101 at 30 mg enrolled 18 healthy adults.

All Cmax and half-life entries below are arithmetic mean ± SD; the Tmax entries are the review's reported mean values. Dose is **labeled total mass of the four salts**, not amphetamine base.

| Study/formulation | Analyte | Cmax (ng/mL) | Tmax (h) | Terminal half-life (h) |
|---|---|---:|---:|---:|
| 371.102, new 10 mg | d-amphetamine | 15.7 ± 3.01 | 2.72 | 10.9 ± 1.67 |
| 371.102, new 10 mg | l-amphetamine | 5.02 ± 0.89 | 2.89 | 13.5 ± 2.46 |
| 371.102, marketed 10 mg | d-amphetamine | 15.8 ± 3.02 | 2.62 | 11.0 ± 1.96 |
| 371.102, marketed 10 mg | l-amphetamine | 5.00 ± 0.95 | 2.80 | 13.8 ± 2.37 |
| 371.101, new 30 mg | d-amphetamine | 53.1 ± 10.7 | 2.50 | 9.77 ± 1.93 |
| 371.101, new 30 mg | l-amphetamine | 17.0 ± 3.72 | 3.03 | 11.5 ± 2.48 |
| 371.101, marketed 30 mg | d-amphetamine | 52.2 ± 10.9 | 2.58 | 9.97 ± 1.80 |
| 371.101, marketed 30 mg | l-amphetamine | 16.9 ± 3.63 | 2.94 | 11.9 ± 2.26 |

Table 7 reports new-10-mg AUCinf approximately 276 and 107 h·ng/mL for d and l. Table 13 summarizes these with slightly different rounding/SD (including l AUC 108); this is not a reason to silently alter the Cmax/Tmax/half-life reference. The reviewer found the new and marketed formulations bioequivalent and described approximate dose proportionality between 10 and 30 mg. The [FDA approval letter](https://www.accessdata.fda.gov/drugsatfda_docs/appletter/2002/11522scf030ltr.pdf) independently repeats approximately three-hour peaks, the distinct enantiomer half-life ranges and approximate dose proportionality. Neither source validates the application's continuous curve or every generic manufacturer.

Implemented profile uses the **new 10 mg** table values. It applies to Adderall IR and the matching generic family as an explicitly unvalidated reference transfer. Separate d and l channels prevent a fixed 3:1 assumption being applied at every time point: their terminal decay differs. Dose scaling below 10 mg is an extrapolation. Allowing a simulated half-tablet quantity does not assert that any particular package is scored or suitable for splitting.

## Other source-backed profiles supplied in this change

| Reference formulation/dose | Analyte | Cmax (ng/mL) | Tmax (h) | Half-life used (h) | Evidence |
|---|---|---:|---:|---:|---|
| Adderall XR 30 mg, fasted adults | d | 44.3 | 5.2 | 10.4 | FDA 2001, Table 6, N=19 |
| Adderall XR 30 mg, fasted adults | l | 13.3 | 5.6 | 12.7 | Same study |
| Dextroamphetamine sulfate IR 15 mg, 3 × 5 mg tablets | d | 36.6 | approximately 3 | approximately 12 | Label, 12 healthy subjects |
| Dexedrine Spansule 15 mg | d | 23.5 | approximately 8 | approximately 12 | Label, 12 healthy subjects |
| Vyvanse capsule 70 mg, fasted adults | d | 71.75 | 3.70 | 11.3, selected | FDA 2025 study 2793, 28 completers |
| Arynta solution 70 mg, 7 mL at 10 mg/mL, fasted adults | d | 72.61 | 3.42 | 11.3, selected | Same study, solution-specific values |
| Vyvanse chewable 60 mg, fasted adults | d | 56.9 | approximately 4.4 | 11.3, selected | FDA 2017 comparison, N=36; current label |

Sources and qualifications:

- [Adderall XR FDA 2001 review](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2001/21303_Adderall_biopharmr.pdf), Table 6 and Figure 3 (printed p. 12), study 381.103. Fasted d Cmax SD 11.1, Tmax SD 2.0, half-life SD 2.3; l corresponding SDs 3.7, 2.1, 3.3. High-fat food shifted mean peaks to d 7.7 h and l 8.3 h. The registry uses fasted values only. A single smooth curve does not reproduce the two-bead release mechanism. Mydayis, Dyanavel and Adzenys are separate formulations.
- [Dextroamphetamine sulfate IR DailyMed label](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=ca1a8890-0675-4c9c-9716-6c28f975d827) and [Dexedrine Spansule label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=cc717b9b-22ea-4c60-a1d4-ee38a40bce78), Clinical Pharmacology / Pharmacokinetics. Age distribution and meal condition of the tablet-versus-capsule comparison are not specified. Both retain the sulfate-salt dose basis. No liquid or transdermal transfer was inferred.
- [Arynta FDA 2025 review](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2025/219847Orig1s000MultidisciplineR.pdf), Tables 1 and 16 (printed pp. 31, 73), with population on pp. 38 and 43. Cmax values are **geometric means**, with geometric CV 15.84% (capsule) and 18.69% (solution); Tmax values are **medians**, with ranges 1.75–6.00 h and 2.00–6.00 h. Trial eligibility was ages 18–55; completers were 24–55. The tables do not provide a study-specific active-drug half-life.
- [Vyvanse FDA September 2025 label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021977s054,208510s011lbl.pdf), §12.3, gives adult active-dextroamphetamine half-life 10–11.3 h. Selecting 11.3 h is an explicit construction choice. The parent-prodrug half-life below one hour is not appropriate for an active-drug curve. Adult proportionality is reported for 50–250 mg lisdexamfetamine; illustrated lower doses are extrapolations, not a new validated range. Food can delay the peak.
- [Vyvanse chewable FDA 2017 review](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2017/208510Orig1s000ClinPharmR.pdf), Table 1 (printed p. 4), gives active d-amphetamine arithmetic-mean Cmax 56.9 ± 14.7 ng/mL and AUCinf 1168 ± 270 h·ng/mL after the 60 mg chewable. The current label supplies the chewable-specific 4.4 h peak. The corresponding parent-lisdexamfetamine value 32.3 ng/mL is intentionally not used.

## Construction, numerical checks and remaining limits

For elapsed time t ≥ 0, the proposed illustration is peak-normalized Bateman absorption/elimination:

`C(t) = Cmax × [exp(-ke·t) - exp(-ka·t)] / [exp(-ke·Tmax) - exp(-ka·Tmax)]`.

`ke = ln(2)/halfLife`; `ka > ke` is solved from `Tmax = ln(ka/ke)/(ka-ke)`. Dose scaling multiplies by recorded labeled dose/reference labeled dose. This creates the stated peak and terminal slope but is not a source-published formula or a fitted full concentration trace. Smooth XR/SR curves can miss release shoulders. Geometric-mean Cmax plus median Tmax does not reconstruct a group-mean trace.

Independent Node assertions verified all seven supplied profiles, twelve catalog product mappings, every source link ID, matching dosage units, positive finite parameters, zero initial value, the stated peak, and post-peak decline. For mixed-salt IR, derived ka is 1.1173567713 h^-1 (d) and 1.1170521199 h^-1 (l). The constructed AUCinf is 293.51 and 113.41 h·ng/mL, around 6–7% above the study summaries. For XR it is 940.00 and 330.80 versus study 851 and 289, approximately 10% and 14% higher. Thus matching peak and half-life does **not** also match observed AUC. Vyvanse capsule construction gives 1467.72 versus 1492.39; solution 1460.02 versus 1479.12; chewable 1215.01 versus 1168. These numerical comparisons quantify approximation limits rather than validate the profiles.

Studied dose-proportionality ranges are described in the notes, not enforced as prescription limits or presented as proof that all displayed doses were studied. Repeated-dose addition assumes time-invariant linear kinetics and records sufficient prior administrations; missing records do not mean absence of carryover. An incomplete analyte contribution must remain unknown rather than become a false zero. The current user request is one formulation view and, where needed, one selected enantiomer; no d/l activity total and no cross-product total is appropriate for that view.

This source audit read primary FDA and DailyMed content. The older scanned FDA tables were recovered from the official document's indexed extraction and crosschecked against repeated study synopsis/half-life tables and the approval letter. The web screenshot response returned no usable image and direct PDF downloads returned HTTP 404, so no claim of pixel-level transcription verification is made. No points were digitized or invented from those figures. No private records, production endpoints, authentication, security settings or Git operations were accessed or changed in this work. Application integration and browser validation are separate checks performed after this data delivery.

## First independent integration crosscheck

After the root integration was present, read the numerical evaluator, eligibility, direct/estimated contribution separation, timeline scope, formulation choices, chart sampling and formula explanations. Synthetic assertions passed for the mixed-salt IR peak; unknown direct evidence; separate d/l channels; preservation of saved relative-unit assumptions; permitted IR halves and rejected XR fractions; invalid-record partial totals; recorded-history geometry; and server rendering of just one selected formulation/analyte. Input snapshots remained unchanged. The only module-level numeric memo inspected is a WeakMap keyed by public static channel parameters; it stores no dose or account records.

The first UI pass reproduced one functional issue: Vyvanse capsule and chewable had different choice IDs but identical `Vyvanse` option labels. This was reported to the parent for a formulation-label fix. This paragraph records the first-pass finding, not the subsequent fix status.

TypeScript no-emit checking passed. The then-current `pk-reference-integration`, `medication-display`, and `timeline-series` test files passed all 13 tests. A separate ephemeral synthetic script exercised the assertions listed above. This was not a full-suite or browser-interaction run; those remain separately owned by the parent.
