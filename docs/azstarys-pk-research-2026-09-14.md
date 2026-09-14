# Azstarys 组合胶囊：单次参考资料

核对日期：2026-09-14。原始来源：[当前DailyMed标签，§§11–12.3 / Figure 1](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=00b5e716-5564-4bbd-acaf-df2bc45a5663)（既有S8）；[FDA 2021综合审评第53页](https://www.accessdata.fda.gov/drugsatfda_docs/nda/2021/212994Orig1s000MultidisciplineR.pdf)。实看官方图的[原始JPG](https://dailymed.nlm.nih.gov/dailymed/image.cfm?name=azstarys-03.jpg&setid=00b5e716-5564-4bbd-acaf-df2bc45a5663)，本机审阅副本为`/private/tmp/azstarys-figure.jpg`。未改计算引擎。

一次 **52.3 mg serdexmethylphenidate / 10.4 mg dexmethylphenidate**，健康成人空腹。测定活性 **d-methylphenidate**：mean Cmax **14.0 ng/mL**、median Tmax约 **2 h**、terminal half-life **11.7 h**、AUC **186 ng·h/mL**。前药serdexmethylphenidate本身的5.7 h半衰期不能替代活性成分11.7 h，也不能把它的浓度另加成一条d-MPH曲线。

§12.3明确单次26.1/5.2至52.3/10.4 mg范围近似线性。稳态约第三次每日给药后接近，Cmax/AUC0–24较单次约高37%；**该37%不是一次曲线的额外乘数**。成人参考不能替代儿童的体重与暴露差异。

## 可用的完整图形近似

Figure 1取**实心黑圆**Azstarys；空心圆是40 mg dexmethylphenidate ER比较药，不能套入。实心平均曲线峰约12.3 ng/mL @ 2 h，与个体Cmax的平均值14.0不是同一个统计量。以下是对该小尺寸图的人工取整近似，不是原始采样数据：

```ts
{
  group: 'd-Methylphenidate', cmax: 12.3, peakHours: 2, halfLifeHours: 11.7,
  points: [
    [0, 0], [0.5, 0.6], [1, 7.8], [1.5, 12.2], [2, 12.3],
    [3, 11.1], [4, 9], [5, 8], [6, 7.6], [7, 7.5], [8, 7.1],
    [10, 5.8], [12, 5.2], [13, 5.1], [16, 4], [24, 3],
    [36, 1.4], [48, 0.5], [60, 0.1], [72, 0.03],
  ],
}
```

线性插值、72 h后按11.7 h半衰期接尾，全为带星号估计；基线/低尾取整不证明个人零浓度。用现有evaluator独立梯形积分（0.005 h步长至600 h）：AUC **179.661**，相较186为 **−3.41%**。如果反而把14.0/2/11.7三个参数直接代入普通单峰吸收公式，会约266 ng·h/mL，明显偏高；应保留完整形状。该误差核对不是生物等效性或个体有效性验证。

## 最小组合输入契约

只为现有`azstarys`产品提供**一条**组合产生的d-MPH通道。保留完整两成分package snapshot：

| 包装规格 SDX/d-MPH（mg） | 相对参考包装估计比例 |
|---|---:|
| 26.1 / 5.2 | 0.5 × 胶囊数 |
| 39.2 / 7.8 | 0.75 × 胶囊数 |
| 52.3 / 10.4 | 1 × 胶囊数 |

比例来自固定配比的三个标示规格，而不是对被取整的第一成分小数作精确比值。两成分都有游离形式与盐形式的标示差异；输入沿用包装的52.3/10.4等两数，不相加为62.7 mg活性d-MPH，也不先将前药换算后再叠加完整曲线。

引擎应校验产品ID、完整合法包装、capsule/mg单位、两成分名称/顺序/strength与amount是否都等于包装×quantity，再套固定比例。非标自定义组合、缺失一个成分、矛盾snapshot保持不可计算；不允许只因第一成分相同就通用匹配。若内部`referenceDoseMg`暂需标量，可存52.3并清楚写明只是第一成分标示量，**不能沿用通用scalar比例分支**。标签允许打开后整份服用，不意味着任意分胶囊量；这里不新增分胶囊模型。

建议label：`Azstarys 52.3/10.4 mg adult figure reference`。note须包括均值曲线人工取整、不同于mean individual Cmax14、独立combo通道、线性插值/尾部/剂量缩放均为估计，不宣称其他dexmethylphenidate制剂等效。

Onyda XR本轮仍保留缺口：标签比较药是0和12 h各一次0.1 mg ER片，未核实独立单次悬液绝对参数组合；不借用clonidine ER片剂数据补图。
