# ADHD Medication Tracker and Timing Simulator

Version 0.2 — complete revised implementation brief, 13 September 2026

## 1. Instructions for the implementing AI

Build an English-language, mobile-first web app for recording ADHD medication use, exploring dose timing, and reviewing long-term history. Its central feature is a continuous, date-aware interactive chart showing each dose and their combined modeled exposure, including contributions carried into later days. Deliver a working application, its source, database migrations, a reproducible medication/model registry, deployment instructions, and meaningful verification of the calculations and persistence.

This brief incorporates the user's successive clarifications. In particular:

- A simulation does **not** require a prescription schedule to be entered first. Users can choose products, amounts, and administration times themselves.
- Use natural controls: **Add dose**, **Dose 1**, **Dose 2**, **Dose 3**, and so on. A dynamic list supports three, four, or many more administrations, including doses on later dates. Do not repeat “hypothetical” on every label.
- Show component curves **and** the combined curve, including Ritalin IR plus Concerta when modeled on a compatible methylphenidate scale.
- Calculate across calendar boundaries: tomorrow's doses add to modeled contributions from yesterday and any earlier relevant administrations. Neither midnight nor changing the displayed date clears the model.
- Show estimated onset and effect duration as **time intervals**, with reported or assumed variability kept separate from the concentration profile.
- Missing published graphs must not leave the user with an empty experience. Use sourced parameters where possible; otherwise offer a visibly assumption-only illustration.
- Cover the breadth of US ADHD medicines and formulations, not only methylphenidate or the handful with readily available graphs.
- Persist actual dose history in a backend, including at least monthly and lifetime review, totals by product, and a clinician-readable export.
- Store the sleep schedule in the personal **Profile**, shade those intervals noticeably darker on every relevant chart date, and show modeled exposure during them with appropriately qualified sleep information. Do not call it “hypothetical sleep.”
- Improve time editing and reading: explicit calendar dates, familiar clock-time inputs, clearly separated day labels, and a useful multi-day view.
- The interface, chart labels, reports, reference page, and disclaimer are in English.

The user is brainstorming a future build. This document is a handoff, not evidence that a production website has already been built or deployed. Do not infer the user's current regimen from the example numbers or speech transcription. Do not enter historical medical facts as actual dose events. Drug amounts must use explicit units; an ambiguous spoken “grams” must never silently become a real medication record.

Suggested working name: **Dose Timeline**. It is replaceable. Use a clean chart-centered design, readable typography, restrained colors, and no generated photographs.

## 2. Product behavior and screens

| Screen | Required behavior |
|---|---|
| Today | Quick logging from favorite medicines; actual doses; current time; modeled component and total curves; sleep overlay; optional observed-effect entries. |
| Simulator | Add, remove, duplicate, change, and drag doses in a dynamic list; compare scenarios A/B; change strengths and quantities; inspect overlap and cross-day carryover; save scenarios independently. |
| History | Calendar and chronological list; 7-day, calendar-month, last-30-day, custom, and lifetime ranges; search/filter by product. |
| Reports | Actual administration details, totals, missing-data disclosure, optional symptom/sleep summaries, PDF/CSV export. |
| My medications | Favorites, exact formulation/manufacturer, usual package strength, quantity unit, optional personal schedule, inventory. |
| References & methods | Source documents, section/figure, study conditions, parameter provenance, model equations/assumptions, versions, limitations. |
| Profile | Personal time zone, 12/24-hour display, target sleep schedule, weekday/weekend overrides, and optional display preferences. |
| Settings | Account, notifications, export/backup, and deletion. Link to Profile for personal sleep/time preferences. |

Keep the initial setup short: choose medicines, set common strengths, optionally set a sleep schedule in Profile. A demo Simulator can work without login; durable personal history requires a recoverable account. Never imply anonymous browser storage is a durable cloud account.

### Dose-list interaction and mode clarity

Use the screen name **Simulator** or a single compact mode indicator to establish the context. Place the short simulation notice once near the chart. Keep row labels and buttons concise; do not use “hypothetical dose,” “hypothetical second dose,” or “hypothetical sleep” as routine UI copy.

Each dose row is backed by a stable event identifier and displays an ordinal, exact medication/formulation, strength, quantity, calculated amount, calendar date, clock time, and accessible actions to duplicate or remove it. The action at the end is **Add dose**. There is no special second-dose checkbox and no two-dose limit. Removing Dose 2 must not corrupt Dose 3's values or change the identities used by saved scenarios. Use a scrollable or collapsible list for larger scenarios; do not make the plot unreadably small.

Adding a row is a user action, not an automatically selected treatment time. Prefer a new row with an unfilled date/time; it is marked pending and excluded from the model until complete. An explicit **Duplicate** action may copy a time, which remains editable and is not presented as a recommendation. Clearing or invalidating an existing row's date/time must also remove that row from the active calculation until corrected; never leave a hidden old timestamp contributing. Support adding multiple administrations on the same day or on later days. An optional **Repeat on dates…** action can create occurrences from a schedule the user explicitly supplies; show those occurrences before applying them. Do not infer the next day's regimen from yesterday's pattern.

Within the Simulator, changes remain scenario data until the user explicitly records an actual administration. **Log a dose** is the action that writes actual history. Both modes can be simple without mixing their data. A scenario can start empty or use a visible snapshot of recorded history as its baseline; the baseline choice, coverage, and included events must be inspectable.

### Fast actual logging

The main action is **Log a dose**. Display product, formulation, strength, quantity, calculated amount, and administration date/time before saving. For a saved favorite, two interactions should normally suffice. Support “Now” and backdating. After the explicit save, persist automatically and offer Undo.

Record both package strength and quantity. Examples: one 10 mg tablet; half a suitable 10 mg tablet; 2 mL of a specified mg/mL solution. Do not assume every tablet or extended-release product may be divided. If a user records an unusual administration that actually happened, preserve the event and flag that the standard model may not apply.

Keep **actual**, **planned**, **skipped**, and **simulated** events distinct. A notification being delivered or dismissed does not prove ingestion. Editing a favorite's strength must not change old events. Duplicate taps and offline retries must not create duplicate doses.

### Main chart

The default chart shows the selected day's timeline with enough previous history to include relevant carryover. Provide **Day**, **48 hours**, **72 hours**, and a navigable custom range. The calculation's history window is independent of the visible chart window. Midnight changes the date label; it must not reset the model to zero. See the cross-day contract in Section 3.

- One thin line per administration, a thicker total for each compatible analyte group, explicit administration markers, and a “Now” marker.
- Actual/planned status and evidence quality use separate visual encodings. For example, dose-marker shape distinguishes recorded from scenario events; line dash or a badge identifies an estimated model. Keep a clear legend.
- A crosshair reports every visible dose's contribution and the total at exactly the selected time. Support tap-to-pin and keyboard-accessible time selection.
- Dragging a dose in the Simulator horizontally changes its time and recomputes the curves immediately, including all later days in the displayed range. Also provide date and time inputs so dragging is never required. Dragging an actual-history marker must not silently edit a medical record.
- Dose/strength changes update vertical scale only through a supported model or an explicitly assumed scaling rule. Do not normalize each new scenario to its own maximum when comparing amplitudes.
- Scenarios A/B use identical axes and units. “Higher modeled peak” is a numerical comparison, not a verdict about efficacy or safety.
- If the sum includes an uncertain component, its label inherits that uncertainty. The total cannot be labeled “FDA curve.”
- Show source population and conditions on demand. “ng/mL” means a reference plasma concentration model, not a measurement of this user.
- At the selected time, distinguish **Earlier doses** from doses administered on the displayed local date; make that subtotal expandable into individual administrations. A previous-day dose is still part of the total even if its administration marker is off-screen.
- Render unknown or unsupported tails as unknown, or as a separately identified tail estimate if one is justified. Never draw the available components as an unqualified complete total when a required contribution is missing.

### Dates and time controls

Use a clearly labeled selected date with previous/next-day buttons and a calendar picker. Provide a **Today** shortcut. In multi-day views, place a day header above each day segment, such as **Mon, Sep 14**, and a stronger divider at each local midnight. Clock ticks align to familiar whole hours. Use shorter intervals on wide screens and fewer ticks on narrow screens; do not overlap tick labels or rely solely on numeric “+1d” suffixes.

Dose rows use an explicit date plus a native or accessible clock-time control, honoring the Profile's 12/24-hour preference. **Today** and **Tomorrow** may be friendly shortcuts, but show the resolved date alongside them. A keyboard user can enter an exact time without dragging or moving an hour-offset slider. If step buttons are provided, use a clearly marked increment such as 15 minutes while retaining exact manual entry.

Tooltips and pinned readings display date, time, time zone, medicine, amount, contribution, and evidence status. A crosshair on tomorrow must never show only a time that could be mistaken for today. Highlight **Now** only when the actual current instant lies inside the displayed window; a demo must not mislabel an arbitrary time as now.

Calendar days are local-time concepts and may be 23 or 25 hours at daylight-saving transitions. Compute exposure using elapsed time between instants, not subtraction of clock-hour labels. Resolve ambiguous or nonexistent local input times explicitly. Changing the viewing time zone changes labels and day groupings, not the saved administration instant or the modeled exposure at that instant.

### Onset and effect-duration track

Place an aligned track below the concentration chart for **reported or assumed effect windows**. Do not force concentration to zero when an effect window ends.

The effect track is a horizontal interval, not merely a peak dot or a vertical line at an “end time.” Give each administration its own row when overlap would otherwise be ambiguous. A duration range can have a central or nominal interval plus a lighter uncertain edge, provided the meanings are labeled. The concentration curve begins according to its PK model at administration; it must not be held at zero until the user's subjective onset time. When supported, onset can itself be a range rather than a single invented exact minute.

The user's illustrative example is: dose at 08:00, onset at 08:30, four hours of effect after onset, nominal end at 12:30. If the assumed duration range is 3–5 hours after onset, the end range is 11:30–13:30. These are user-supplied example assumptions, **not an FDA statement about a particular product**.

For every duration field, store its time origin: `from_administration`, `from_onset`, or an explicitly observed endpoint. Many sources report duration after administration. Read that definition rather than adding onset twice. A range's midpoint is not a measured population mean unless the source says so.

Separate data types:

| Available evidence | Display |
|---|---|
| Reported onset or duration range | Horizontal time band with the reported endpoints and source. |
| Mean Tmax and SD | A timing marker/band labeled “mean ± SD”; never imply it is a 95% interval. |
| Pointwise concentration SD, CI, or percentiles | A concentration band using exactly that statistic. |
| Only mean Cmax and its SD | A peak-magnitude summary, not a time-varying uncertainty envelope. |
| User observations | Separate markers labeled “Your report,” with the recorded date. |
| Assumed values | Clearly marked assumption band with editable parameters. |

Do not fabricate a whole-curve confidence band from a duration range or one SD. Do not silently assume uniform or normal distributions. For repeated-dose uncertainty, individual clearance/absorption parameters are shared across that person's doses; independently resampling a new person for each dose is incorrect. Without joint distribution/covariance information, show component evidence or a clearly labeled sensitivity envelope, not a statistically established total confidence interval.

### Sleep overlay

The personal **Profile** contains optional **Sleep schedule**, **Bedtime**, and **Wake time**. These preferences persist with the account and are automatically used by Today, Simulator, History charts, and optional report charts. Show a compact schedule summary with an **Edit in Profile** action near the chart. Do not put a “hypothetical sleep” toggle into each scenario and do not require users to re-enter sleep for every dose.

Support crossing midnight, weekday/weekend overrides, and eventually multiple intervals for naps or shift work. A daily sleep log can override the target with actual observations without rewriting the default schedule. Distinguish the target schedule from actual recorded sleep in data and chart details. Equal bedtime and wake time needs explicit interpretation; do not silently treat it as either zero hours or 24 hours. For a simple first version, request distinct times and provide an explicit way to clear the schedule.

Shade sleep intervals **noticeably darker** than waking hours, behind the curves, while maintaining contrast in both light and dark themes. Label the interval **Sleep** and show bedtime/wake boundaries. Apply the overlay to every intersecting interval, including sleep that began before the visible left edge and sleep continuing into the following day. A 23:00–07:00 schedule must produce one continuous overnight interval, not two unrelated sleep events.

Provide compact readings for modeled concentration at bedtime and waking, and the contribution of each administration, including administrations on previous dates. If appropriate, expose the modeled concentration range during the interval. A missing history or tail contribution must qualify these readings too. Do not label AUC or a percentage of reference peak as “drug remaining in your body.” Do not produce remaining-body-mass in mg from plasma concentration without a separately justified body-distribution model.

Keep source-based statements such as a label's insomnia warning alongside the relevant source. Do not calculate an individual probability of insomnia or mark a universal “safe to sleep below X” threshold. Let the user record sleep onset time, time to fall asleep, awakenings, and perceived sleep quality. Later show descriptive associations, with sample counts, between their medication timing and sleep; do not claim causality.

### Timing guidance and reminders

The simulator can answer **“What does this model show if another dose is taken at this time?”** It can show official administration information and compare manually selected times without requiring a prescription.

Present any official timing information with its exact product, indication, age group, and source. Do not turn an adult/child label passage, a trial schedule, or a falling curve into a universal instruction to take another dose. For example, a regimen used in an FDA comparison figure is not the user's regimen.

Personal reminders can follow a schedule the user enters, optionally transcribed from their prescription. Show reminders as **“Scheduled dose”**, not “You need more medication.” Do not automatically add doses, increase amounts, optimize stimulant use for studying/exercise, or select a supposedly optimal medical regimen. An optional comparison can sort user-created scenarios by explicit modeled quantities, but must not rank one as the best treatment.

Allow transparent exploration outside the model's verified dose range only in assumption mode, with different units/labeling as needed. Record a factual out-of-range event if it occurred, but do not extrapolate an authoritative concentration or certify the event as safe. A plotted line does not evaluate drug interactions.

## 3. Evidence and modeling architecture

Use a deterministic, versioned calculation library. An LLM may assist offline source review, but must never invent parameters at runtime or decide the user's next dose.

### Four evidence levels

| Level | Basis | Presentation |
|---|---|---|
| A: Published profile | Product-specific concentration-time data or digitized official figure. | “Reconstructed published group profile”; identify dose, population, analyte, and conditions. |
| B: Parameter-based estimate | Official numerical PK parameters with an explicitly selected mathematical model. | “Estimated from published parameters”; show model assumptions and fit limitations. |
| C: Justified proxy | Data from another formulation/study with a documented scientific bridge. | “Proxy estimate”; name the proxy and limitations. Same ingredient alone is insufficient. |
| D: Assumption-only illustration | Insufficient product-specific data; user-adjustable onset, duration, shape, and relative amplitude assumptions. | “Illustrative assumptions — not a product-specific PK prediction”; dimensionless axis, no predicted ng/mL. |

Every medicine remains loggable and has a visible timeline. Where A–C cannot be supported, provide D and display its assumptions prominently. Dose alone cannot determine absorption, bioavailability, release pattern, distribution, or clearance. Do not quietly seed D with fabricated “typical” parameters and present it as the selected medicine's expected behavior.

Use wording such as **“No suitable product-specific curve was located in the reviewed sources as of [date]”**, rather than the stronger and potentially false “No official data exist.” A medicine may have no published graph but still have useful official parameters.

Do not add a dimensionless schematic to a concentration curve. Display it in an aligned separate panel. A star must remain visible in screenshots and exports, and open the explanation of the assumptions.

Level D must still support repeated-dose overlap: declare a fixed reference dose and dimensionless amplitude, show the assumed component curves and their illustrative sum, and let time/quantity changes update both. Keep the reference scale fixed across scenarios. Do not imply that the illustrative sum establishes actual concentration or combined clinical effects; different medicines may only share such an illustration when the common arbitrary scale and assumptions are explicitly stated.

### Superposition

For a supported linear, time-invariant reference profile with dose-proportional scaling:

\[
C_{total}(t)=\sum_i \frac{D_i}{D_{ref,i}} C_{ref,i}(t-t_i).
\]

This is an assumption-based calculation, not proof that subjective effects or adverse effects add linearly. A reference kernel must represent a **single administration**, unless the entire studied regimen is intentionally the scenario unit. Do not take a figure of three IR doses and reuse that whole curve as if it were one tablet.

Before summing, verify compatible analyte, matrix, units, dose convention, and modeling scale. Track racemate versus d-isomer measurements explicitly. Never add separately peak-normalized curves and label the result a concentration. Do not add methylphenidate and amphetamine into one “total stimulant level.” Use separate aligned analyte panels. Also retain separate components for d- and l-amphetamine where the source reports both.

**Ritalin IR + Concerta is a required scenario.** A reference reconstruction plus a parameter-based IR profile can produce an educational mixed-product estimate if their plasma methylphenidate scales are compatible and the transfer of adult study references is disclosed. Do not represent such cross-study superposition as a validated combination trial or an individualized prediction. If a chosen pair lacks a defensible common scale, fall back to separate panels until a justified model bridge exists.

Source-dose interpolation and extrapolation are different operations. Enable dose scaling only over an explicitly justified range. Preserve release mechanisms: delayed/multiple release pulses, osmotic delivery, prodrug conversion, or patch wear/removal cannot all be replaced with the same four-hour triangle.

### Continuous cross-day calculation: required behavior

**Tomorrow's curve includes the modeled contribution of today's doses and all earlier doses that remain relevant under the selected model.** Do not calculate each calendar day independently and then concatenate the charts. Do not erase residual contributions when the user changes the date, the clock reaches midnight, or a new dose is added. An effect window ending does not prove that the drug has been eliminated.

For compatible linear models, the sum above ranges over all included administrations at or before the query instant, not just the administrations whose markers are currently visible. For models requiring state evolution, carry the full relevant model state forward through time and incorporate each administration into that continuing state. Do not assume linear superposition for a product whose chosen model does not support it.

Use the following calculation contract:

1. **Resolve the timeline.** Convert each dated administration into an unambiguous instant; retain original time zone, amount, formulation, event identity, and model version. Include patch removal and other model inputs where required. Sort deterministically. A clock time without a date is insufficient for multi-day scenarios.
2. **Choose the view without trimming the data.** The user-selected visible range controls the chart, not the set of contributing administrations. A Day view, a 48-hour view, and a 72-hour view must yield the same value at their shared query instants, given the same model versions and source events.
3. **Load the required past.** Every model declares its supported input/absorption duration, observation domain, tail policy, and history requirements. Fetch enough earlier events to include delayed release, slow clearance, ongoing input, and any relevant accumulated model state. Do not hard-code “yesterday only,” a 24-hour lookback, or a universal five-half-life rule for the whole catalog.
4. **Account for tails.** A validated mathematical model may have a nonzero tail well after its visual effect window. Compute it directly, or use a documented numerical cutoff only when the omitted aggregate contribution can be bounded below a declared computation tolerance. That tolerance is an engineering approximation, not a medical safe level. Check the sum of omitted contributions; many individually small tails cannot be discarded solely by a per-dose rule. If no reliable bound is available, fetch more history or disclose incomplete calculation.
5. **Handle finite published traces.** The final sampled point in an FDA figure is not the time of complete elimination. Beyond it, either use a scientifically justified, separately labeled tail model or return an unknown contribution. Do not substitute zero. Keep known components visible as **Known contributions** if a complete total is unavailable, and explain the missing part. Offer an explicit **Published data only** mode when useful; that mode may legitimately have an incomplete later total.
6. **Handle unknown prior history.** When records start midway through ongoing medication use, say **Earlier dose history unavailable** unless the user has explicitly established a reliable medication-free baseline. Do not invent a dose, silently assume steady state, or present the calculated contribution of recorded doses as a complete personal baseline. Scenario authors may explicitly select an empty starting history as an assumption.
7. **Preserve provenance.** Return every contribution's administration date/time, model/evidence status, interpolation or tail-estimation status, and any missing-history flag. The total and sleep readings inherit the relevant limitations. Cache keys must include all contributing event revisions, baseline state, model versions, and assumptions, not merely the displayed date.

The calculation result should distinguish three concepts: **modeled concentration at this instant**, **contribution from earlier administrations**, and **recorded amount consumed during a selected date range**. They answer different questions. A dose recorded yesterday can contribute to today's modeled level without being counted again as a tablet taken today.

For a supported exponential tail after an explicitly chosen anchor `t*`, one possible extension is:

\[
C(u)=C(t^*)\exp[-k_{e,tail}(u-t^*)],\qquad u>t^*.
\]

This requires an appropriate elimination-rate source and an explicit assumption that terminal washout applies after the anchor. It must join continuously to the existing trace. A generic extension is not automatically valid for ongoing absorption, delayed delivery, prodrug conversion, or a different formulation. Use a dashed segment or equivalent accessible encoding for the extension and qualify any combined curve that depends on it. Section 12 describes the proposed Concerta demonstration extension separately from the digitized data.

For products used continuously, including nonstimulants, the required history or initial state may span multiple days and the relationship between concentration and clinical benefit needs its own evidence. Never turn a daily peak into an immediate “focus starts now” claim. A steady-state display is permissible only with a supported model and an explicitly selected, sufficiently defined repeated schedule or established model state; do not treat it as the user's state from an incomplete log. Preserve the distinction between a single-dose profile, a profile measured during repeated dosing, and a model initialized at steady state.

### Recorded history as a scenario baseline

A scenario may use an immutable snapshot of relevant actual history up to a selected cutoff, then add user-entered scenario doses after or around it. Display **Includes recorded history through [date and time]** and make the included administrations inspectable. Loading the same actual event through two queries must include it only once. If the user intentionally changes a copied baseline event in the scenario, represent the replacement explicitly; do not sum both the original and its edited copy. The source actual record remains unchanged.

Simulation and reporting must use compatible but distinct queries. A report for September can display a September 1 concentration curve informed by August 31 administrations, while September consumption totals include only actual administrations inside the explicitly selected reporting boundaries. Recomputing a chart must never create new dose records or inventory transactions.

### Optional simple parameter model

For an immediate-release illustration with a one-compartment model and first-order absorption/elimination:

\[
k_e=\ln(2)/t_{1/2},\qquad
C(u)=\frac{F D k_a}{V(k_a-k_e)}(e^{-k_eu}-e^{-k_au}),\quad u=t-t_i-t_{lag}\ge0.
\]

If F/V is not known, amplitude may be anchored to a compatible reference Cmax; identify this as a parameter-based approximation. Derive an absorption parameter from Tmax only under explicit model assumptions, rather than claiming that Tmax and half-life uniquely determine the true absorption process. Handle the limit near `ka == ke` numerically.

For controlled input, a release-rate model may use convolution with elimination. Keep dissolution/release rate units (e.g., mg/hour) distinct from plasma concentration units. Clinical onset/offset belongs to a separate effect model or observation track.

Return a model result with values, analyte/unit, evidence level, model version, validity window, unsupported assumptions, and any missing history. Do not silently set the curve to zero outside the observed time domain. Mark truncation or use a justified, labeled tail extrapolation. Do not infer unknown doses before logging began.

### Uncertainty and personalization

Preserve whether a source uses arithmetic/geometric mean, median, SD, SE, CI, interquartile range, or observed min–max. Neither population variability nor the confidence interval of a study mean is automatically an individual prediction interval.

Modelled sensitivity bounds may be useful, but must name the changed parameters and be labeled “assumption range.” Personal onset/offset observations can inform a separate descriptive effect-window estimate. Do not infer an individual's clearance, blood level, CYP2D6 status, or dose requirement from a few focus or sleep ratings.

## 4. Medication directory and reference maintenance

Treat ingredients, products, formulations, strengths, and manufacturers as separate entities. Search by brand, generic name, and common spelling variants. Favorites refer to the exact selected product, not only an ingredient.

Use this as a **discovery checklist**, not an assertion that every brand/pack is currently sold. The historical product survey [S16], newer labels, Drugs@FDA, and Orange Book [S17] provide starting points. Verify active marketing separately and retain discontinued names for old records.

| Ingredient/family | Products or formulations to resolve |
|---|---|
| Methylphenidate IR | Ritalin; Methylin; generic tablets, chewables, and solutions. |
| Methylphenidate ER | Concerta, Relexxii, Ritalin LA, Aptensio XR, Metadate CD, Quillivant XR, QuilliChew ER, Cotempla XR-ODT, generic ER/SR/CR/LA/CD formulations. |
| Delayed-release methylphenidate | Jornay PM. |
| Transdermal methylphenidate | Daytrana. |
| Dexmethylphenidate | Focalin, Focalin XR, corresponding generics. |
| Serdexmethylphenidate + dexmethylphenidate | Azstarys. |
| Mixed amphetamine salts | Adderall IR, Adderall XR, Mydayis, corresponding generics. |
| Amphetamine formulations | Evekeo / ODT, Dyanavel XR suspension/tablet, Adzenys XR-ODT; resolve other current ER products. |
| Dextroamphetamine | Zenzedi, ProCentra, Dexedrine/Spansule and generics; Xelstrym patch. |
| Lisdexamfetamine | Vyvanse capsule/chewable, generics, Arynta oral solution [S13]. |
| Methamphetamine | Desoxyn/generic status, indication, and formulation to verify. |
| Atomoxetine | Generic atomoxetine; Strattera retained as a searchable brand/reference. |
| Guanfacine ER | Intuniv and generics. |
| Clonidine ER | Kapvay/generic ER tablets; Onyda XR liquid [S12]. |
| Viloxazine ER | Qelbree [S11]. |
| Newer approved ingredients | Simtriyo (centanafadine): FDA lists ADHD approval on 24 July 2026 [S14, S15]. Verify actual market availability independently. Follow its current label classification rather than assuming it is a nonstimulant. |
| Optional off-label/co-medication records | Bupropion formulations; IR clonidine/guanfacine and other user-entered medicines, clearly separated from FDA-approved ADHD indications. |

Historical aliases such as Adhansia XR, Ritalin SR, Metadate ER, and older discontinued brands must not be presented as currently purchasable solely because a historical label exists.

For broad coverage, the release process must produce an inventory of verified current FDA-approved ADHD ingredient/formulation families, reconcile it against the app catalog, and identify any outstanding gaps. Do not describe a manually typed list of familiar brand names as “all US ADHD medications.” Approval, submitted labeling, current marketing, and pharmacy stock are distinct facts.

DailyMed's version-2 SPL service supports structured product/label discovery [S18]. Store application numbers, SPL Set IDs/versions, RxNorm identifiers where available, labeler, route, dosage form, active ingredients, strength conventions, indication age group, status date, and source URLs. Labels are periodically revised; re-check before production and create a reviewable diff for updates. Do not let a background scrape silently replace a validated numerical model.

For each parameter store its value/unit, statistic type, population, dose, fed/fasted conditions, sampling time basis, source section/page/table/figure, retrieval date, transformation, and status: `reported`, `digitized`, `derived`, `proxy`, or `assumed`.

## 5. Selected evidence already located

These are research anchors, not a complete current medication database. The dated documents should be checked against current labeling before use in a released product.

| Product | Relevant finding | Implementation implication |
|---|---|---|
| Concerta [S1] | §12.3 contains an 18 mg single-dose curve versus three 5 mg IR doses four hours apart. The single-dose study lists Tmax 6.8 ± 1.8 h; the text reports peaks across doses at 6–10 h. §12.2 says the exposure-response time course is not fully characterized. | Reconstruct the single-dose trace; keep peak timing variability separate from effect onset and full-curve uncertainty. |
| Ritalin IR [S2] | A 10 mg tablet reference reports Cmax about 4.3 ± 2.3 ng/mL and average Tmax about 2 h. | Useful amplitude/timing anchors for a disclosed simplified model. |
| Ritalin LA [S3] | Two release components; adult Ritalin-tablet half-life is about 3.5 h with a broad reported range. | LA needs its own profile. The half-life can support an adult IR approximation with provenance. |
| Adderall/XR [S4] | IR peak is around 3 h; XR around 7 h. The label plots d- and l-amphetamine separately and describes food-dependent timing. | Separate analytes; do not use an MPH model or treat the XR figure as a universal onset rule. |
| Vyvanse [S5] | Lisdexamfetamine is converted to dextroamphetamine; parent and active species have different time courses. | Model the active species explicitly; capsule and chewable conditions need their own evidence. |
| Focalin XR [S6] | Immediate and delayed release components deliver dexmethylphenidate. | Do not equate its labeled mg or curve to racemic methylphenidate without a justified conversion. |
| Jornay PM [S7] | Evening dosing and a long absorption delay are described. | Include cross-midnight delivery; do not start a generic morning IR curve at ingestion. |
| Azstarys [S8] | Two named ingredients include a prodrug and active dexmethylphenidate. | Preserve both package-strength components and avoid double-counting prodrug conversion. |
| Xelstrym [S9] | This is a dextroamphetamine patch with product-specific PK and application instructions. | Record application and removal, not just a swallowed-tablet event. |
| Atomoxetine [S10], Qelbree [S11] | These have their own PK and clinical-effect evidence. | A daily concentration curve is not evidence of an immediate focus window after every dose. |
| Onyda XR [S12] | The label distinguishes its extended-release liquid from other clonidine products. | Store liquid concentration/volume and a formulation-specific model. |
| Simtriyo [S14] | Its label reports slightly greater-than-dose-proportional exposure over a studied range. | Broad catalog coverage requires models that need not use linear dose scaling. |

NICE NG87 supports monitoring sleep, weight, heart rate, and blood pressure during ADHD treatment [S19]. This motivates optional tracking fields; it does not establish a medication-concentration threshold for exercise, meals, or bedtime.

## 6. Supporting functions

Include a small daily check-in: perceived onset/offset, focus, appetite, headache or other side effects, and optional notes. Add manual sleep, meals, caffeine, exercise, pulse/BP, and weight entries as optional modules. Keep the default interface uncluttered.

Study planning can use the user's reported focus windows and calendar preferences. Meal reminders can follow user preferences plus accurately quoted/paraphrased product-specific food instructions. Exercise scheduling follows the user's availability and experience; do not mark a high-concentration interval as medically recommended for a workout. An elevated modeled level does not establish cardiovascular status.

Inventory can subtract actually consumed tablets/capsules/volume from a manually entered supply and estimate remaining days from observed use. An edited or undone dose must reverse the correct inventory transaction. Do not send refill requests or share records automatically.

## 7. Persistent history and clinician reports

History is a first-release requirement, not a later optional feature. Retain records until the user explicitly deletes them; a one-month review must not imply a one-month retention limit.

Store exact administration instants, original local time zone/offset, event creation time, edits, product/strength snapshots, quantity, and amount. Preserve a correction history without allowing deleted records to reappear during synchronization. Keep a clear difference between no record, a confirmed skipped dose, and a confirmed medication-free day.

Reports should include:

1. Selected date range/time zone, optional user-provided name, generation time, and whether offline changes remain unsynced.
2. A summary by exact product and strength: number of administrations, total tablets/capsules or liquid volume, total labeled mg of each ingredient, and days with recorded use.
3. Daily amounts and administration times, plus a detailed chronological table.
4. Optional reported effects, side effects, sleep entries, and selected charts.
5. A missing-data note: no log does not prove no dose. Do not calculate adherence without a defined intended schedule and reliable observation coverage.
6. A separate optional appendix for saved simulations. These never enter actual consumption totals.
7. For included model charts, the model version, relevant history coverage, and any carryover from before the report's starting date. Those earlier administrations inform the curve but do not enter the report period's consumption totals.

Do not combine unrelated drugs into a single milligram total. For combination products preserve ingredient amounts individually. A total tablet count may be shown for inventory, but must retain the per-product breakdown and not imply dose equivalence.

Export CSV for analysis, JSON for a complete versioned backup, and a readable PDF for clinician review. CSV exports must escape spreadsheet formula injection in text fields. JSON import needs a preview, schema validation, duplicate detection, and an explicit replace/merge choice. By default, reports are downloaded by the user; they are not sent to anyone.

## 8. Recommended architecture and deployment

**Default: React + TypeScript + Vite PWA on Cloudflare Pages, with Supabase Auth/Postgres for durable personal data and IndexedDB for an offline queue/cache.** This is a design recommendation, not an already-created service.

| Layer | Choice and purpose |
|---|---|
| Frontend | React/TypeScript, accessible form controls, responsive charting. Vite builds a static client. |
| Modeling | Pure TypeScript package with versioned source datasets and deterministic calculations, executed client-side; use a worker if needed for uncertainty calculations. |
| Hosting | Cloudflare Pages; its React guide documents `npm run build` and `dist` [S20]. A comparable static host can be substituted without changing the model. |
| Accounts and durable data | Supabase Auth and Postgres. Apply row-level authorization to every user-owned table and test isolation [S21]. |
| Offline | IndexedDB cache and transactional outbox. Clearly display “Saved on this device,” “Syncing,” or “Synced.” Never show cloud success before server acknowledgment. |
| Reports | Generate downloads from an authorized consistent data snapshot. Prefer client-side generation for the first version. |
| Notifications | Optional Web Push with a small server-side scheduler/function; VAPID/private keys stay on the server. |
| Reference updates | Versioned review pipeline, separate from user activity. Published labels/models are read-only to ordinary users. |

No dedicated GPU, LLM service, or continuously running personal VPS is needed for these calculations. Do not purchase infrastructure or select paid plans without the user choosing to do so. Avoid quoting unverified future costs; plans, backup retention, inactivity behavior, and quotas must be checked when deploying.

If implemented in an environment that already provides managed Sites hosting and a durable authenticated database, adapt the hosting adapter to that environment. Preserve the same persistence, isolation, model, and export requirements. Do not build an attractive localStorage-only demo and call the backend finished.

On iPhone, Web Push is supported for suitably installed Home Screen web apps; permission must follow user interaction [S22]. A JavaScript timer in a closed tab is not a reliable reminder service. Design reminders as best-effort with a test-notification flow. A notification cannot be taken as evidence that a dose occurred.

Keep personal health data out of analytics payloads, public URLs, crash logs, and cacheable public responses. HTTPS, database authorization, secret management, backups, and account deletion are required. An app lock alone is not encryption. Do not claim end-to-end encryption, FDA approval of the app, or regulatory compliance merely because these tools are used.

## 9. Suggested data entities

| Entity | Essential fields |
|---|---|
| `profiles` | user ID, time zone, time format, optional sleep schedule, weekday/weekend overrides, schedule time-zone policy; no presumed personal regimen. |
| `medication_products` | stable ID, ingredients, brand/generic, formulation, route, manufacturer, package strengths, labeled units, approval/marketing metadata. |
| `references` | publisher, title, URL, document revision, retrieval date, section/page/figure, content hash, review status. |
| `model_versions` | product mapping, analyte/matrix, reference dose, parameters/trace, evidence level, assumptions, supported conditions/range, units, source IDs, observed domain, supported tail policy, input duration, history/initial-state requirements, numerical tolerance. |
| `user_medications` | owner, product, preferred strength/quantity, favorite order, optional personal schedule and inventory link. |
| `dose_events` | owner, immutable event ID, administered instant/time zone, product/strength snapshot, quantity, ingredient amounts, actual/planned/skipped status, patch removal if relevant, revision/tombstone. |
| `dose_event_revisions` | owner, event ID, revision, old/new values or immutable corrected event, timestamps, device/request ID. |
| `scenarios` and `scenario_doses` | owner, independent scenario events with complete dates/instants, stable IDs, referenced actual baseline snapshot/cutoff if used, source-event replacement mapping, model versions, assumptions, comparison settings. |
| `history_coverage` | owner, medication or scope, explicitly established coverage intervals or medication-free intervals, observation/source method; distinguishes confirmed absence from missing records. |
| `daily_checkins` | owner, time, reported focus/onset/offset/side effects/notes, explicit scales. |
| `sleep_events` | owner, target versus actual, date/time zone, bed/onset/wake times, awakenings, quality. |
| `inventory_transactions` | owner, package unit/strength, signed quantity change, reason, linked dose or correction. |
| `reminders` | owner, explicit selected schedule/time zone, enabled state, private push subscription metadata, cancellation/version. |

Use decimal-safe stored amounts and preserve the input's original strength convention, such as salt mass versus active-base equivalent. Never convert these silently. Every user-owned table, related child row, and private storage object must enforce ownership; knowing a UUID is not authorization.

Store actual timestamps in UTC plus their original local context. Choose a report time zone explicitly so travel or daylight-saving changes do not silently move old administrations into a different calendar month. Sync requires idempotent event IDs, retry-safe mutations, explicit conflicts for concurrent dose edits, and deletion tombstones. Old scenario results must be reproducible after a model update.

An optional computed-state cache can speed up long histories, but it must be derived and reproducible. If a historical dose is corrected, invalidate affected later states and charts; the cache must not preserve an obsolete residual contribution. A model update also invalidates unpinned current-view caches while saved scenarios retain their pinned version. Do not store only a daily total as the input to the PK model: timing and formulation of individual events are essential.

## 10. User-facing language

Preferred primary labels: **Add dose**, **Log a dose**, **Dose 1**, **Date**, **Time**, **Profile**, **Sleep schedule**, **Bedtime**, **Wake time**, **Day**, **48 hours**, **72 hours**, **Earlier doses**, and **Total modeled concentration** when a complete compatible model sum is available. Use **Known contributions** for an incomplete sum. A single **Simulator** context label establishes that its editable doses are scenario entries. Keep evidence notes beside the chart or in the legend rather than repeating long qualifications in every control.

Place a short notice near simulations, with detail in References & methods:

> Educational simulation based on published group data and stated assumptions. It may differ substantially from your experience and does not measure your drug level or determine when you should take medication. Follow your prescription and discuss changes with your clinician.

For missing-model illustrations:

> *Assumption-only illustration. No suitable product-specific model was established from the reviewed sources. This curve shows the selected assumptions, not a prediction of this medicine's concentration or effect.*

For mixed-product estimates:

> *Approximate superposition of compatible reference profiles. Combined use and individual response are not validated by this chart.*

For sleep:

> Modeled concentration during your Profile sleep schedule. This does not predict whether you will fall asleep or how well you will sleep.

For cross-day context:

> Includes contributions from earlier recorded doses.

When applicable, qualify that statement with **Earlier history unavailable** or **Includes a modeled tail beyond the published curve**. Put the detailed method behind an accessible information control and retain the qualification in exported charts.

Avoid “FDA predicts your level,” “safe concentration,” “take another now,” “four hours means fully cleared,” and “twice the concentration means twice the benefit.” A disclaimer does not turn unsupported numbers into evidence.

## 11. Build order and acceptance criteria

Build the complete core before polishing secondary modules:

1. Product/source/model schemas; actual event persistence and account isolation.
2. Concerta reconstruction, a disclosed IR model, same-product and mixed-MPH superposition, cross-day carryover, and an interactive simulator with a dynamic dose list.
3. Date/time controls, 48/72-hour views, evidence grades, effect-duration intervals, variability semantics, Profile sleep persistence, darker sleep shading, and bedtime/waking readings.
4. History, totals, PDF/CSV/JSON export, offline synchronization and backups.
5. Broad catalog reconciliation, progressively verified models, assumption-only fallback, reference UI.
6. Favorites, reminders, basic check-ins, and small inventory module; more detailed lifestyle analysis can follow.

Do not declare the user's requested broad catalog or persistent history complete if only a two-drug prototype exists. Catalog coverage and model evidence level are separate release metrics.

Required checks include:

- A dose contributes nothing before administration, except documented baseline handling; chart truncation is not represented as clearance.
- **Add dose** creates at least four independently editable rows, and the design remains functional with a larger list. Removing or reordering a middle row preserves the other rows' identities, times, and quantities. UI controls do not repeatedly say “hypothetical.”
- Moving a dose moves its modeled profile by the same interval; changing timing visibly changes overlap.
- Two equal simultaneous doses double a supported linear single-dose profile; non-linear models are not forced to pass this identity.
- Ritalin + Concerta shows both components and an appropriately qualified total on a compatible scale; amphetamine + methylphenidate yields separate panels.
- Effect-window duration is measured from the declared origin. The 08:00/08:30 example gives 12:30 only when four hours is explicitly measured from onset.
- Official ranges, SD, CI, and assumption envelopes retain their meanings. Missing pointwise uncertainty does not produce an invented band.
- A medicine with only Level D assumptions still shows how adding or moving multiple doses changes the component curves and their illustrative sum on a fixed dimensionless scale.
- Effect duration renders as a legible interval. The 3–5-hour example gives an explicitly assumed end range of 11:30–13:30 when onset is 08:30; it is not falsely labeled a measured confidence interval or a clearance time.
- A Profile sleep schedule survives sign-out/sign-in and appears consistently in Today and Simulator. Shading 23:00–07:00 crosses the date boundary correctly, is visibly darker than waking hours, and bedtime/waking readings equal the chart at those times. Day views beginning during sleep shade the ongoing portion. Multi-day views include every intersecting sleep interval.
- One dose on Day 1 and another on Day 2 produce a Day 2 curve equal to the supported component sum at independently checked instants. Test same-product and Ritalin/Concerta combinations. Verify that the value just after midnight is the continuation of the value just before it, apart from any actual dose or documented model discontinuity at that instant.
- A dose on Day 0 still contributes on Day 2 when its supported model requires it. A previous-day delayed-release administration can begin contributing on the next day. A patch already applied before the visible window retains its relevant state and removal event.
- Day, 48-hour, and 72-hour views agree at the same UTC instant with the same event set/model. Panning or choosing Tomorrow changes visibility without discarding earlier doses.
- At a finite trace endpoint, published-only mode reports unsupported later contributions as unknown, never zero. If the tail extension is enabled, verify continuity at the join, its declared decay formula, dashed/qualified rendering, and propagation of the tail status into the total and sleep readings.
- History truncation and incomplete logs propagate to the displayed result. A numerical tail cutoff must satisfy the declared bound on the **aggregate** omitted contribution, including a deliberately large repeated-dose case.
- A scenario baseline and newly added doses have no duplicate event IDs. Replacing a copied baseline dose changes only the scenario. Scenario totals do not silently count both the original and edited dose.
- Correcting an old administration recomputes every affected later contribution and invalidates stale cached states. Inventory and reporting changes occur exactly once.
- Midnight, DST, travel, previous-day doses, partial history, invalid amounts, liquids, combination strengths, and patch removal are handled.
- Actual, planned, and simulated records cannot contaminate one another's totals.
- Log → restart → sign in on a second device preserves records. Offline retry and duplicate tap do not double-count. Concurrent edits and deletion sync have explicit behavior.
- A second account cannot read, edit, export, or attach rows to another account's data, including via direct API calls.
- A known month of test records yields independently checked tablet/volume and per-ingredient mg totals. Corrections, missing days, and time-zone boundaries are included.
- An administration just before the report period can affect the first chart day without appearing in that period's consumed-dose count or mg total. Changing the display time zone preserves modeled values at absolute instants.
- Exported reports remain readable, carry uncertainty/disclaimer labels, and contain only selected data. Import/export round-trips preserve meaning and versions.
- The interface works on narrow iPhone screens, touch and keyboard; plot controls and labels do not overlap. Multi-day headers and exact dated tooltips clearly distinguish today from tomorrow, and every drag action has an input-based alternative.
- A saved scenario is reproducible with pinned model versions. Every number that appears to be official can be traced to an actual source.

## 12. Reproducible prototype data

The conversation prototype uses a digitized Concerta polyline and an IR parameter estimate. It is an interaction demonstrator, not a validated clinical model. The revised interaction includes **Add dose** with independent dated rows, pending-time handling, Profile sleep controls, effect intervals, and 24/48/72-hour views. Any example administrations, sleep hours, or effect-window assumptions are demonstration inputs, not a record of the user's medical history. It uses a fixed-offset demonstration clock; the production app must implement the time-zone and daylight-saving requirements above. The full production catalog, authentication, durable Profile/history storage, and exports remain required even if the demonstrator uses only these two reference products.

The revised prototype passed JavaScript syntax and DOM-ID checks and direct computation checks using its own model functions with pinned D3 7.9.0. These covered reference points, terminal-tail continuity and half-life decay, mixed-product sums across dates, nonzero earlier-dose contributions, equal simultaneous doses, exclusion of pending rows, date rounding across midnight, effect-window endpoints, and overnight sleep intersections. A separate code review checked time editing and chart logic. Browser layout and end-to-end interaction tests were not completed; these checks do not establish clinical validity or production readiness. Treat the prototype as a design reference and run the complete acceptance checks on the implemented website.

Concerta source [S1], Figure 1, PDF page 21 (1-based). The vectors were extracted with PyMuPDF `get_drawings()[91]`. Calibration: x=200.038986 at 0 h and x=447.322601 at 32 h; y=245.667053 at 0 ng/mL and y=92.453369 at 5 ng/mL. PDF SHA-256: `75419c5c8cce8d3b595acb25c0235dbf028496c2abd547fe2162f96a1312ec5a`.

Approximate `(hours, ng/mL)` coordinates, preserving the plotted trace rather than claiming raw participant measurements:

```json
[[0,0.024],[0.257,0.036],[0.498,0.534],[0.995,1.917],
 [1.493,2.108],[2.007,2.091],[3.002,2.160],[3.998,2.330],
 [6.005,3.544],[7.996,3.366],[9.987,2.816],[11.994,2.104],
 [13.984,1.388],[16.987,0.781],[19.973,0.449],[23.971,0.227],
 [29.976,0.073]]
```

Use piecewise-linear interpolation for reconstruction. The small nonzero initial plotted value is retained as a digitization artifact/limitation. Do not extrapolate beyond the last trace point silently. The peak of an averaged curve need not equal the average of individual participants' peak times or peak concentrations.

**Demonstration tail, separately tagged as estimated:** after `t* = 29.976 hours`, extend the Concerta reference using `C(u) = 0.073 * exp[-ln(2)/3.5 * (u - 29.976)]`, with concentration in ng/mL and time in hours. The half-life is an adult reference value from the label [S1]; the extension's anchor, terminal first-order washout, and absence of further absorption are modeling assumptions. The label describes biexponential decline; this terminal exponential is a simplified extension, not a reconstruction of the full distribution process. The extension is continuous at the last digitized point but is **not** another segment of published FDA graph data. Label it **Estimated tail** and render it distinctly. This supports an illustrative 48/72-hour carryover view without claiming clearance at the figure's endpoint. The demonstrator uses the tagged extension; implement **Published data only** mode in the full app if provided, returning an unknown Concerta contribution after the endpoint instead. A total incorporating the extension inherits its estimated status. Do not generalize this tail to all formulations or populations.

IR prototype: 10 mg reference, Tmax 2 h, Cmax 4.3 ng/mL [S2], half-life 3.5 h [S3]. Under the stated no-lag first-order assumptions, `ke = 0.1980420516 /h` and `ka = 1.0152449556 /h`. With `u >= 0`, calculate `4.3 * (exp(-ke*u)-exp(-ka*u)) / (exp(-ke*2)-exp(-ka*2))`. This is a constructed reference approximation, not a published concentration-time dataset or an independently validated fit. Combining it with the reconstructed trace adds a cross-study transfer assumption.

## 13. Sources

Accessed 13 September 2026. A URL containing a year is not proof it is the latest label. Preserve these versions for reproducibility and check for updates before release.

- **S1 — FDA Concerta label, revision 02/2026.** §§12.2–12.3, Figure 1, Table 7. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/021121s34s40s45lbl.pdf)
- **S2 — DailyMed Ritalin IR prescribing information.** SPL Set ID c0bf0835-6a2f-4067-a158-8b86c4b0668a, §12.3; retrieved listing has revision metadata 02/2025. [Open source](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a)
- **S3 — FDA Ritalin LA label, 2025.** §§11–12.3, Figure 1/Table 4. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021284s050lbl.pdf)
- **S4 — FDA combined Adderall XR / Vyvanse / Mydayis label PDF, 2026.** Adderall XR §12.3 and Figure 1; take care to identify the correct product section within this multi-product file. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/021303s040,021977s052,208510s009,022063s007lbl.pdf)
- **S5 — FDA Vyvanse label, 2025.** §12.3. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021977s054,208510s011lbl.pdf)
- **S6 — FDA Focalin XR label, 2025.** §§11–12.3. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021802s045lbl.pdf)
- **S7 — FDA Jornay PM label, revision 09/2025.** §12.3 and Figure 1. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/209311s013lbl.pdf)
- **S8 — FDA Azstarys label, 2023.** §§11–12.3; dated reference requiring current-label verification. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2023/212994s007lbl.pdf)
- **S9 — DailyMed Xelstrym.** Product-specific administration/PK reference. [Open source](https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=0862f02a-72a8-41cc-8845-57cf4974bb6f)
- **S10 — DailyMed Strattera/atomoxetine.** Historical brand reference; verify current generic label/marketing independently. [Open source](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=309de576-c318-404a-bc15-660c2b1876fb)
- **S11 — FDA Qelbree label, revision 01/2025.** [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/211964s013lbl.pdf)
- **S12 — FDA Onyda XR label, revision 06/2024.** [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/217645s001lbl.pdf)
- **S13 — FDA Arynta oral-solution label, 2025.** [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/219847s000lbl.pdf)
- **S14 — FDA Simtriyo label, 2026.** §§1, 12.3. [Open source](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/218145s000lbl.pdf)
- **S15 — FDA novel drug approvals for 2026.** Approval entry for Simtriyo. [Open source](https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2026)
- **S16 — IQVIA stimulant-trends report hosted by DEA.** Appendices 2–3, historical product-discovery checklist, not current pharmacy availability. [Open source](https://www.deadiversion.usdoj.gov/pubs/docs/IQVIA-Report-on-Stimulant-Trends-2024.pdf)
- **S17 — FDA Orange Book.** Approved-product discovery and therapeutic-equivalence reference. [Open source](https://www.fda.gov/drugs/drug-approvals-and-databases/approved-drug-products-therapeutic-equivalence-evaluations-orange-book)
- **S18 — NLM DailyMed v2 SPL API documentation.** [Open source](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_api.cfm)
- **S19 — NICE NG87 recommendations.** Monitoring and review, including sleep. [Open source](https://www.nice.org.uk/guidance/ng87/chapter/recommendations)
- **S20 — Cloudflare Pages React deployment documentation.** [Open source](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)
- **S21 — Supabase Postgres row-level security documentation.** [Open source](https://supabase.com/docs/guides/database/postgres/row-level-security)
- **S22 — WebKit Web Push for iOS/iPadOS Home Screen web apps.** [Open source](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

## 14. Remaining setup choices

The implementing AI can proceed with the defaults above. Product naming, colors, sign-in provider, and hosting adapter are routine implementation choices. Before recording real personal doses, the user must select the actual medicine/formulation/strength. Real prescription schedules, individual effect-window assumptions, actual bedtime, and cloud-service credentials must not be invented. These setup choices should not prevent implementing and testing the complete application with clearly labeled synthetic data.
