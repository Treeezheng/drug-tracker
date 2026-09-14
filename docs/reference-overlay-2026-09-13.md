# 统一药物入口与参考估计层

2026-09-13 当前候选。用户要求同成分、对应剂型的品牌和仿制药只保留一个选择入口，并在有合适既有模型时显示参考计算值。目录核对过的 8 对产品在选择器合并，规格去重，新规格默认创建 generic 收藏；旧收藏、记录、库存的 productId、厂家和规格快照不迁移。同一成分的不同释放系统、液体、贴片、咀嚼剂型仍独立。

Ritalin 标签给出 10 mg 后约 4.3 ± 2.3 ng/mL 的峰值与平均 2 小时达峰；Ritalin LA 标签提供成人 Ritalin tablet 的半衰期资料。本应用已有 Ritalin 曲线是按这些跨研究参数构造的 B 级参考，不是发布的原始连续采样数据，也不是用户实测浓度。[Ritalin DailyMed §§3、12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a)、[FDA Ritalin LA §12.3](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021284s050lbl.pdf)

Generic 标签证实同名盐、口服片剂及 5/10/20 mg 规格可存在，但目录没有核验每个实际厂家/NDC 的生物等效性或个体 PK。FDA 对获批 generic 有成分、规格、剂型及生物等效性等要求；这不把目录中的家庭级快捷入口变成已核验的具体厂家，也不把 Ritalin 的构造曲线变成该用户的实测值。[Generic methylphenidate hydrochloride tablet 标签](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=981a2ad8-33f7-4678-9162-9df9685bd4a6)、[FDA Generic Drugs Questions & Answers](https://www.fda.gov/drugs/generic-drugs/generic-drugs-questions-answers)

`referenceForDose` / `referenceOverlay` 提供既有来源模型的参考示意，目前支持 methylphenidate IR 目录 5/10/20 mg 的完整片剂记录，以及 Concerta 自身目录规格的完整片剂记录。公式为 `Cillustration(t) = recordedAmount / referenceAmount × Cref(t)`，IR 以 Ritalin 10 mg 为基准，Concerta 以既有 18 mg 轨迹为基准。比例缩放是明确的未验证假设，不是新增的临床数据；Concerta 观测末端之外仍仅是已注明的 3.5 小时半衰期延续。S2/S3 或 S1 随实际显示的模型进入来源列表。

`concentration` / `groupedTotals` 的原证据契约不变：generic 或不满足原参考资格的记录，其直接模型值仍 unknown。新增 `estimateContribution` / `estimateTotals` 是图表显示层，可将同一分析物、同一单位的已有模型与可用参考计算值相加；`hasReference`、`directValue`、`directComplete` 分别保留参考标志、原模型数值与原模型完整性。显示估计值不应被描述为完整实测浓度。完全未知的贡献仍为 null；混合部分未知时仅显示可计算部分，不能用未来服药的有效零值掩盖已发生的未知贡献。

图上不再依靠虚线传达缺数据：普通曲线、药名和估计读数的星号指向同一个 **No drug data** 来源/公式说明。说明放在展开详情，避免在每条曲线旁重复长段提示。对参考计算值的展示不改变正式服药记录、剂量单位或备份内容。

自定义规格即使凑足参考总量、半片、异常给药、液体、其他释放系统、其他成分、无效剂量/时间、不可用模型版本或已存的相对单位示意图，不获得这些新参考。其他 7 对品牌/generic 虽已统一选择入口，但当前没有已实现且匹配的浓度模型，仍只能画服药时间；不借用 methylphenidate 参数制造 amphetamine 等药物的 ng/mL 数字。`tests/reference-overlay.test.ts`、`tests/timeline-estimates.test.ts` 和药物选择回归覆盖上述边界；这是程序验证，不是临床等效性验证。
