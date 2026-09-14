# 自定义规格与通用药目录补充核验

核验日期：2026-09-13。只涉及参考曲线准入校验及 dextroamphetamine IR 通用药规格，不改变曲线方程、研究数据或历史记录。

界面允许记录自定义 package strength，并不证明该规格是所选产品的已核实上市包装。参考模型现在同时检查：产品自身已有模型、未标注 unusual、规格属于该产品目录、packageStrength 与 strength 的十进制值一致、单位与药量基准一致、正整数片数、精确 strength × quantity = amountMg，且总量为既有 10 mg Ritalin 或 18 mg Concerta 参考值。旧记录缺少可选 packageStrength/strengthUnit 时沿用原 strength 和既有产品单位信息；显式矛盾字段不忽略。

例如 Ritalin 2.5 mg × 4、Concerta 9 mg × 2，不能因总量恰好为 10/18 mg 获得 B/A 曲线。Concerta 36 mg 半片也不会被当成完整的 18 mg 渗透泵制剂。合法记录仍保留；旧记录中已接受的 D 级无量纲示意仍可读取，本界面不能新建或接受这些假设。通用 methylphenidate IR 不因品牌界面合组自动继承 Ritalin B 模型。现有参考数值与正常整片记录行为保持。

[Concerta FDA 标签](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/021121s34s40s45lbl.pdf)列出 18/27/36/54 mg 规格并要求整片吞服；[Ritalin DailyMed 标签](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a)列出 5/10/20 mg。参考模型仍是原有群体曲线重建或参数构造，不是个人血药浓度测量。

目录原 dextroamphetamine IR generic 的 5/10 mg 不是该通用药家族的完整规格。[Winder Laboratories DailyMed 标签](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ca1a8890-0675-4c9c-9716-6c28f975d827)（标签更新 2025-06-18，说明书修订 2025-05）的 Description、How Supplied 和包装信息明确列出 2.5、5、7.5、10、15、20、30 mg dextroamphetamine sulfate tablets，对应 NDC 75826-120 至 75826-126。已补齐这七个规格及单独来源 C26。该条目仍为厂家待核对的 generic 家族、证据 D、无产品专属曲线；不替用户断言服用的是 Winder 或 Zenzedi，也不证明当前药房库存。标签显示刻痕随规格不同，没有向整组传播分片规则。
