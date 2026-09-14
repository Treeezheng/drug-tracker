# Generic IR 的独立参考曲线

2026-09-13。用户希望无该产品直接曲线资料时仍能查看已存在的相关参照。当前只为完整、未标记异常的 **generic methylphenidate IR 10 mg × 1 tablet** 显示单独的 **Ritalin 10 mg reference only** 曲线。

Ritalin 标签给出 10 mg 后约 4.3 ± 2.3 ng/mL 的峰值与平均 2 小时达峰；Ritalin LA 标签提供成人 Ritalin tablet 的半衰期资料。本应用已有 Ritalin 曲线是按这些跨研究参数构造的 B 级参考，不是发布的原始连续采样数据，也不是用户实测浓度。[Ritalin DailyMed §§3、12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a)、[FDA Ritalin LA §12.3](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021284s050lbl.pdf)

Generic 标签证实同名盐、口服片剂及 5/10/20 mg 规格可存在，但目录没有核验每个实际厂家/NDC 的生物等效性或个体 PK。单凭成分和剂型相同不能把 Ritalin 数据宣称为该 generic 的直接数据。[Generic methylphenidate hydrochloride tablet 标签](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=981a2ad8-33f7-4678-9162-9df9685bd4a6)

`referenceForDose` / `referenceOverlay` 是独立展示接口。原剂量 productId、成分/厂家快照、库存身份不变；`concentration` 与 `groupedTotals` 中该 generic 仍是 unknown，不能用参考虚线补成完整真实浓度总和。图表须写明 **No direct data for this product · Ritalin 10 mg reference only** 并区别线型，Sources 应包含 S2 与 S3。未来或跨午夜的参照只按同一记录时间平移，不伪造日期。

5 mg 两片、自定义规格凑足 10 mg、半片、异常给药、液体、缓释、其他成分、无效剂量/时间或已存的相对单位示意图不获得此曲线。其他缺少合适参照的药物仍不能捏造曲线。`tests/reference-overlay.test.ts` 覆盖这些边界及原始数据不变；这不是临床等效性验证。
