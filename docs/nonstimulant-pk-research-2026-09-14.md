# 非兴奋剂参考曲线：一次给药证据核对

核对日期：2026-09-14。以下是用于带星号参考曲线的成人研究参数，不是个体血药浓度、用药建议或即时药效窗口。四条曲线均为由汇总 Cmax/Tmax/终末半衰期构造的吸收消除形状，未称作实测曲线；没有把稳态均值作为一次给药脉冲叠加。

| 目录 ID / 剂型 | 一次参考剂量及人群 | Cmax (ng/mL) | Tmax (h) | 半衰期 (h) | 同条件 AUC∞ (ng·h/mL) |
|---|---|---:|---:|---:|---:|
| atomoxetine / capsule | 40 mg atomoxetine base；空腹健康成人、CYP2D6 extensive metabolizers；PK N=24 | 333 | 1，中位数 | 4.2 | 2110 |
| intuniv / guanfacine ER tablet | 1 mg guanfacine base；空腹健康成人 N=52 | 0.98 | 6，中位数 | 17.5 | 32.4 |
| clonidine-er / ADHD ER tablet | 0.1 mg clonidine HCl；空腹健康成人 N=14 | 0.258 | 6.5，均值 | 12.65 | 6.729 |
| qelbree / viloxazine ER capsule | 200 mg viloxazine base；空腹健康成人 N=28，AUC/半衰期 N=27 | 1330 | 5，中位数 | 7.02 | 27300 |

## 原始证据及不能混用的条件

- **Atomoxetine：**[FDA 2002 临床药理审评 Part 2，第92–93页 LYAL / Table 1](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2002/21-411_Strattera_biopharmr_P2.pdf)。25人入组、一次40 mg市场胶囊的PK统计 N=24；使用算术均值，未混用同页几何均值、餐后组、两颗20 mg比较制剂或下一项60 mg LYAZ研究。AUC原单位 µg·h/mL，乘1000。人群是明确的 extensive metabolizers，不能据此推定使用者的基因型。
- **Guanfacine ER：**[FDA临床审评 Table 5.1](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2009/022037s000medr.pdf)明确是一次1 mg空腹研究；亦给C24=0.53 ng/mL。[现行Intuniv标签 §12.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=b972af81-3a37-40be-9fe1-3ddf59852528)的参数表写once daily并作了取整，因此以审评明确一次给药的原数值为准。未读取相邻图为一次给药轨迹，未借用Tenex IR数据。
- **Clonidine ER：**[DailyMed §12.3 Table 7](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=0100c70d-7fde-46a1-8374-940550a27e43)。15人三期交叉研究，ER空腹组参数N=14；Cmax原为258 pg/mL、AUC6729 pg·h/mL，均除1000。剂量沿用包装HCl质量，不能改为0.087 mg游离碱或套给其他ER剂型。
- **Viloxazine ER：**[FDA综合审评第206页 Table 139](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2021/211964Orig1s000IntegratedR.pdf)，812P103第1天单200 mg ER空腹组，48小时采样；后面的140–141表才是随后重复给药。Cmax原1.33 µg/mL、AUC∞27.3 h·µg/mL，均乘1000。Tmax取本表中位数5小时，不混用另一个汇总表的均值5.25；该研究还含IR比较组，不予借用。

## 剂量缩放、代谢和模型误差

[2026年6月Strattera标签 §12.3/12.5](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=309de576-c318-404a-bc15-660c2b1876fb)给出10–120 mg比例性；poor metabolizers的暴露和消除明显不同，强CYP2D6抑制剂亦可显著增加暴露。标签概述的5.2/21.6小时半衰期不能替换本研究EM组的4.2小时后仍声称参数全属同组；没有将稳态约5倍Cmax简单套成单次PM曲线。

Intuniv标签报告成人1–4 mg一次给药的剂量比例性；高脂餐、CYP3A4药物相互作用与肝肾功能可影响暴露。Clonidine这里仅有0.1 mg成人一次给药，没有把儿童重复给药0.2–0.4 mg/day数据写成成人单次比例性验证。[Qelbree现行FDA标签 §11/12.3](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/211964s013lbl.pdf)报告100–600 mg比例性；200 mg是游离碱标示量。食物、肾功能及其他药物影响未个体化处理。剂量比例性不验证整条曲线或任意剂量，也不是推荐剂量区间。

独立梯形积分（0.005小时步长、至600小时）检查构造形状的总体暴露：

| 曲线 | 构造 AUC | 与研究均值之差 |
|---|---:|---:|
| Atomoxetine | 2379.805 | +12.79% |
| Guanfacine ER | 31.3797 | −3.15% |
| Clonidine ER | 6.72302 | −0.09% |
| Viloxazine ER | 22068.463 | −19.16% |

Qelbree是较粗估计，保留并明示上述偏差；没有为了图形好看添加臆造的采样点或吸收延迟。研究AUC变异较大，也不代表这个形状经过临床验证。Guanfacine构造C24=0.5277，接近独立报告0.53。回归阈值只用于防止单位/剂型/数量级错误，**不是生物等效性判断**。

## 仍未提供的曲线

[Onyda XR现行标签](https://www.accessdata.fda.gov/drugsatfda_docs/label/2024/217645s001lbl.pdf)有0.2 mg悬液单次Tmax与相对Cmax，但比较的是ER片剂0.1 mg在0和12小时各一次；不能用上述片剂单次Cmax乘相对比例冒充悬液绝对Cmax。本轮不提供Onyda曲线。目录没有bupropion，本轮没有新增该药。

数据模块：`pk-reference-nonstimulants.ts`；新来源N1–N3：`pk-reference-nonstimulant-sources.ts`，同时复用S10/S11/C20/C21。研究不更改原记录的证据等级，也不将这些参考参数算作实测或经过临床验证的个体浓度。
