# Oral methylphenidate / dexmethylphenidate model coverage

This was the initial coverage pass. Later implemented formulations and additional source tables are documented in [common MPH references](common-mph-reference-review-2026-09-14.md) and [common stimulant references](common-stimulant-pk-research-2026-09-14.md). Initial “not yet implemented” findings below describe the first pass, not the final registry.

核验日期：2026-09-14。仅使用下列 FDA prescribing information 与 NLM DailyMed 原始标签；本文件是模型扩展证据记录。后续受托建立的数据文件为 `src/lib/pk-reference-mph.ts`，模型函数与UI由根代理集成。所有数值为研究人群统计量，不是用户个人药物浓度，不构成剂量建议。

结论：现有代码只实现 Ritalin IR / Concerta，并不代表其他药没有数据。13 个待查剂型中，8 个标签有绝对浓度数字可作为参考构建的锚点；另 3 个有成人浓度图但本轮没有完成数字化；Metadate CD 的常见浓度数字来自儿童重复服药；Focalin IR 当前标签没有可直接读取的绝对 Cmax 数字。即便 Cmax、Tmax、半衰期齐全，它们也不能唯一确定整条曲线。

## 可用数值与来源

下表所有 Cmax 单位为 **ng/mL**，时间单位为 **小时，自服药时刻计算**。研究剂量不是建议剂量，也不一定是单粒包装规格。未找到的项目明确留空，不从服药 mg 推算出“测得的”浓度。

| 目录 ID / 剂型 | 研究条件、参考剂量与分析物 | 标签数字 | 释放 / 剂量比例证据与实现边界 |
| --- | --- | --- | --- |
| `ritalin-la` / 双释放微丸胶囊 | 成人男性，单次 20 mg HCl，N=8；MPH。FDA §12.3 Table 4 的最后一列，不能误用旁边儿童列 | lag 0.7±0.2；第一峰 5.3±0.9 @ 2.0±0.9；谷 3.0±0.8 @ 3.6±0.6；第二峰 6.2±1.6 @ 5.5±0.8；t½ 3.3±0.4；AUC∞ 45.8±10.0 ng·h/mL | §11 为 50% IR + 50% delayed beads。可用四个时间锚点构建加星号的双峰插值；不能把 50/50 释放直接当成两个相等血药峰。Figure 1 是 **40 mg**，Table 4 是 **20 mg**，不得混用。当前标签没有明确线性范围，提及 20/40 mg 暴露略向上偏。高脂餐降低第二峰约25%。[FDA 2025，PDF页15/Table4](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021284s050lbl.pdf#page=15) |
| `aptensio-xr` / 多层微丸胶囊 | 健康成人空腹单次 **80 mg HCl**，整胶囊；racemic d,l-MPH，Table 2 | Cmax 23.47±11.4；Tmax 2.0；t½ 5.09。撒苹果酱组分别 21.78±9.5、2.0、5.43。整胶囊 AUC∞ 258.1±94.2 | 约40% IR/60% controlled release；初峰约2h、再峰约8h，第二峰高度需 Figure 1 数字化。不能仅画单峰冒充该剂型。80mg 是标签研究剂量，标签推荐日剂量上限60mg；勿把80mg加为默认包装/建议。未找到该标签中的明确比例范围。[DailyMed §11–12.3/Table2/Figure1](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=5adedc01-ebf0-11e3-ac10-0800200c9a66) |
| `quillivant-xr` / ER 混悬液 | 健康成人 N=28，空腹单次 **60 mg HCl equivalent**＝12mL重配后5mg/mL悬液；**d-MPH** | Cmax 13.6±5.8；median Tmax 5；t½ 5.6±0.8 | 约20% IR/80% ER，有 Figure 2。与餐前30min进食的成人表格不同：后者 Cmax17.0±7.7、Tmax4、t½5.2±1.0，不能拼接。未找到明确比例范围。[DailyMed §11–12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c2dc2109-44a6-4797-b04e-18761dd9d45a) |
| `cotempla-xr-odt` / ER 口崩片 | 健康成人 N=38，空腹单次 **51.8 mg MPH base＝2×25.9mg**；Table 2 为 **d-MPH** | Cmax 20.8±5.22；median Tmax 4.98（2.5–6.5）；t½ 4.00±0.73；AUC∞169.1±57.13 | 25% IR/75% ER，Figure 2。不能把51.8mg base当51.8mg HCl。正文摘要Tmax约5h，精确表值4.98。未找到明确比例范围。高脂餐峰降低约24%，Tmax4.5h，不能忽略其条件差别。[DailyMed §11–12.3/Table2](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=33f70f58-c871-42c8-8adb-345caeafefcd) |
| `azstarys` / 前药+IR组合胶囊 | 健康成人空腹单次 **serdexmethylphenidate 52.3mg / dexmethylphenidate 10.4mg**；活性分析物为 **d-MPH** | Cmax14.0；median Tmax约2；d-MPH终末t½11.7；AUC186。前药本身t½5.7，不能拿来替换活性药半衰期 | 26.1/5.2 至52.3/10.4单次剂量近似线性；稳态约第三次每日剂量后接近，Cmax/AUC比单次约高37%。Figure 1 有前药转换导致的持续贡献；建议先数字化整图，不把两包装mg相加，也不另算一条IR后再叠加已经包含IR的完整曲线。餐后Tmax4–4.5h。[DailyMed §12.3/Figure1](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=00b5e716-5564-4bbd-acaf-df2bc45a5663) |
| `relexxii` / ER tablet | **自身产品**72mg、健康成人空腹相对生物利用度研究；MPH | 自身 Cmax19.7、AUC∞206.1；对照2×36mg ER为19.3/200.9。自身描述：初始峰约1.5h，mean Tmax5.5h | 当前标签已包含自身72mg数据，不能称完全无数据。但其Figure1/Table7的18mg、Cmax3.7、Tmax6.8、t½3.5属于另述ER reference数据；没有证据把这一整条曲线直接冒充Relexxii72mg。标签后续3.5/3.6h半衰期和18–144mg比例段也指该ER参考数据，实施时需标明跨研究/参考假设。[DailyMed §12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=22d5fa47-b5b9-4fd9-980c-4eb88e95ae5d) |
| `methylin-solution` / IR oral solution | 空腹健康志愿者单次 **20mg HCl**；该数值段未列N/年龄，不能编造成人样本量；MPH | Cmax9.1（对照20mg IR tablet9.8）；Tmax1–2；t½2.7；AUC46.7（对照50.0） | 可独立建立口服液参考；以瓶标1或2mg/mL×实际mL计算同基准药量。若取Tmax1.5h，是范围中点的建模选择，不是该标签给出的mean。高脂餐峰+13%、AUC+25%、Tmax延迟约1h；未找到剂量比例范围。[DailyMed §12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=9e3c22d9-71d9-46a7-b315-8021c94c4bec) |
| `methylphenidate-chewable` / IR chewable | 健康成人，20mg HCl总量；MPH | Cmax约10；Tmax1–2；t½3。食物研究给空腹Tmax1.5、餐后2.4 | 标签比较IR片未见临床显著PK差异，但本剂型已有自己的20mg数值，不必借Ritalin10mg强行转换。未找到明确比例范围。食物AUC约+20%。[DailyMed §12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e5cb0740-813f-4dce-8c29-d7680c66e77c) |

## 需要图数字化或补充研究，不能把缺失数字写成零

| 目录 ID | 已核验事实 | 当前缺口及可行下一步 |
| --- | --- | --- |
| `quillichew-er` | 健康志愿者空腹单次40mg HCl equivalent；median Tmax5h，t½约5.2h；约30% IR/70% ER。Figure2为40mg ER与20mg IR chewable、6h后再20mg的对照。标签正文没有绝对Cmax，只说相较该两次IR方案峰低约20%、AUC低约11% | **绝对Cmax数值未取得**。现成有标浓度轴的Figure2，可数字化；不能把“IR20mg峰约10”直接乘0.8，比较对象是两次IR的完整方案。未找到明确剂量比例范围。[DailyMed §11–12.3/Figure2](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=defc1205-8e90-4b1e-b862-05e4c35c7364) |
| `jornay-pm` | 健康成人21:00单次100mg；开始10h内可用药量不超过总量5%，median Tmax14h；apparent t½5.9h；20–100mg比例关系。Figure1为成人100mg完整浓度曲线 | **正文无绝对Cmax数字，本轮未数字化图**。可数字化FDA PDF页14；服药后14h是次日上午峰，不能当当天14:00，也不能把前10h当严格数学零。高脂晚餐Tmax再延2.5h、峰低14%。[FDA2025 §12.3/Figure1，PDF页13–14](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/209311s013lbl.pdf#page=14) |
| `focalin-xr` / `dexmethylphenidate-er` | 健康成人20mg XR，Figure1 N=24；对照IR10mg+4h后10mg，N=25。d-MPH；50%IR/50%延释。第一峰约1.5h（1–4），第二峰约6.5h（4.5–7），成人t½约3h；单次5–40mg剂量比例 | **正文无绝对Cmax1/2数字**。应数字化自身Figure1（PDF页16）后建双峰参考；不要把AZSTARYS标签中匿名40mg dex-ER比较药的28.2直接认成Focalin或再除2。Generic只能作为显式参考映射，实际productId保留。[FDA2025 §11–12.3/Figure1](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/021802s045lbl.pdf#page=16) |
| `focalin` / `dexmethylphenidate-ir` | 空腹峰1–1.5h，terminal t½约2.2h；2.5–10mg比例数据为儿童。成人性别研究为两片10mg单次，标签没有在此报告绝对Cmax。分析物d-MPH | **成人单次参考Cmax缺失**。先做明确无ng/mL的归一化形状，或进一步从FDA临床药理审评/同一试验取绝对表。XR图中的IR曲线有第二剂，不能当单剂全时程。不借racemic Ritalin标量伪造同峰。[DailyMed §12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=2016f5c2-95d2-4655-af65-c588c2bf5e6d) |
| `metadate-cd` | 30%IR/70%ER。当前标签Figure1明确**7–12岁ADHD儿童，连续一周20/40mg每日一次**，双峰median1.5/4.5h；约25–30%仅一峰；成人terminal t½6.8h。当前正文已不列旧Cmax具体值 | 旧DailyMed标签给20mg早/晚峰8.6±2.2/10.9±3.9；40mg16.8±5.1/15.1±5.8。**这些不是成人单次**。只能作为带人群与重复剂量标签的历史参考，不能把它变成成人每一剂kernel再重复叠加。旧文的60mg溶液31.8ng/mL也不是Metadate CD。[当前标签](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=29f06562-6b6a-4ca6-b62e-d08a45fb3dd4)、[旧标签数值出处](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=be6f8d00-9281-4f67-b8fc-3de58a4d14f4) |

## 建模建议（以下是工程判断，非标签结论）

1. 先补独立IR口服液/IR咀嚼片与Ritalin LA；这些拥有较清晰的数值基准。双峰由实际锚点或数字化图控制，释放比例不直接等于血药峰比例。Quillivant/Cotempla的成人表也充分，但先建立明确 `d-methylphenidate` 分析物。
2. 对所有新建曲线保留星号：`population / analyte / formulation / dose basis / fed state / single vs repeated / source section / kernel method / extrapolation range`。不能因为标签给出峰值，就把自行选择的吸收函数标为官方曲线。
3. **分析物隔离**：d-MPH与总MPH不是同一测量；不把d-MPH数值直接加到目前的总MPH轴。前药serdexmethylphenidate单独计量，Azstarys完整d-MPH曲线已经含两来源，不重复计数。服药mg基准的HCl/base换算与血中ng/mL不能混为一谈。
4. 单峰公式若拟合Cmax/Tmax/terminal t½，应再以标签AUC做独立校验。三个参数无法唯一恢复释放过程；Azstarys前药曲线尤其不适合仅凭11.7h终末半衰期套普通IR Bateman模型。偏差较大时优先数字化完整曲线，不以星号掩盖不相称的模型。
5. 含mg线性缩放时，将“标签在该范围观察到比例关系”与“本应用对该用户/任意剂量做线性推算”分开。未找到范围的产品不能声称其比例关系已经证实；也不应新增80mg Aptensio包装选择来迎合研究剂量。
6. 数字化须保存原PDF/SPL版本、页码/图号、轴刻度、采样点与误差范围；先插值观测范围，再单独定义外推尾部。**本轮没有完成图像数字化，也没有把图上目测值写成精确Cmax。** FDA PDF截图请求与部分DailyMed图链接未返回可检查的图像内容，因此图-only项目仍是待办。
7. 药代曲线不等于效果持续时间：不要从ng/mL峰或半衰期推导“安全补药”“足量”“一定失眠”等结果。成人参考研究不证明相同剂量适合儿童、肝肾异常者或同服其他药物者。

来源备注：DailyMed URL对应可更新SPL，实施前需固定版本/下载副本；本文“未找到”是对本轮已检查标签的限制，不是声称全世界不存在该数据。查阅未发现可直接导入的官方逐时原始CSV。所有上表数字均来自文字/表格，未从剂量凭空产生Cmax。

## 本轮数据交付

`MPH_PK_REFERENCES` 包含 Ritalin LA、Methylin solution、IR chewable、Quillivant XR、Cotempla XR-ODT 五条独立参考。均复用上表同一来源URL的 S3/C1/C2/C6/C8；没有把Ritalin IR曲线跨剂型搬用。Ritalin LA用三个标签统计锚点加假设零基线/lag，Quillivant和Cotempla用假设零基线到标签峰的直线加估计尾。所有新增插值、尾部、比例缩放均在元数据声明为构造示意。数值精度按原标签；Quilli/Cotempla保持d-MPH独立分析物。

Cotempla补充计算检查：普通一室Bateman按Cmax20.8、Tmax4.98、t½4.0拟合时，AUC约284 ng·h/mL，明显高于标签169.1。线性上升至峰后接上述终末尾的构造AUC约172，数值较接近，但**不能据此声称恢复了实际曲线**；标签Figure2仍应后续数字化。Aptensio缺第二峰高度、Relexxii缺与其72mg同试验的明确半衰期、Azstarys需要前药完整形状，故本轮不为它们创建额外数值模型。

离线专项数据检查已通过：5条profile的目录ID、用量/浓度单位、来源ID、正数有限参数、严格递增的时间锚点。未声称完成临床验证或独立安全审计。
