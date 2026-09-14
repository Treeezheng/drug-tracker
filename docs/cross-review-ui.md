# 独立交叉审查：UI 行为与可访问性

日期：2026-09-13。审查对象为本轮更新后的 `src/App.tsx`、`components/` 与 `styles.css`，并对照 build brief 的交互验收要求。本审查未修改应用代码；浏览器真实布局由另一执行者独立检查，本文件不冒充已完成真机 Safari 或屏幕阅读器测试。行号指审查时快照，后续修复可能移动。

**版本说明：以下问题记录于用户要求“三页面、Taken 操作、中性白灰”全面重构之前。** 后续 App 与 TimelineChart 已重写，A/B、旧场景入口等不再对应新版界面；本文件保存交叉审查证据，不能据此宣称这些问题仍存在。新版需按新的流程复测。

除静态检查外，使用 React 服务端渲染执行了未知历史药品、B-only 图表与可访问属性检查；直接运行了实际 `newDose` / `updateDose` / `groupedTotals` 的四剂操作检查。没有审查或重复验证本审查者先前编写的报告模块。

## 已确认通过的部分

- 四个独立 dose 中删除第二个后，第三个的 ID 与时间保持；复制事件有新的 UUID；清空时间会清除 `administeredAt`，并从模型计算排除。使用真实函数和断言运行通过。
- A/B 在同一 analyte 面板使用共同 `limit`，上限同时考虑 A 与 B 数据，避免把两条曲线分别归一化。这是代码确认。
- Today 传给模型的列表经过 actual 过滤；实际标记禁止拖动修改，实际记录通过单独弹窗保存。这是代码确认。
- SVG 已采用 ResizeObserver 获取实际容器宽度，之前固定 1000 单位导致手机字体极小的问题已作结构性修正；手机每剂贡献已有展开区。真实效果仍由浏览器检查确认。
- Modal 已补 `aria-label`，不再把先前“弹窗无名称”列为未修复项。登录及实际 dose 弹窗已有内部错误信息；新增 dose 后已有聚焦与定位。

## 需要修复的问题

### UI-01 · P1 · 当前 Scenario B 与图表操作/读数不一致

位置：`App.tsx:71`；`TimelineChart.tsx:17–18, 51–66`。

复现：开启 Compare A / B，选择 Scenario B，改变它的时间后拖动图表标记。表单正在编辑 B，但标记只来自 A 的 `members`，`onMove` 始终调用 `setDoses`；实际被改的是 A。图例出现 B 曲线，但数值总量、每剂贡献、effect windows 与 sleep readings 都仅计算 A，B 的未知成分/估算尾部没有等价读数反馈。

独立渲染也确认：A 为空、B 含有效剂量时，图表仍出现“Add a dated dose to start exploring”和“Contributions by dose (0)”。

修复：明确 A/B 标记和事件回调的所属场景，让当前可编辑场景与表单一致；提供同一绝对时刻下 A、B 两组数值及各自 complete/tail 状态。空状态应检查两组。验收时让 A/B 的药品、日期和数量都不同，验证拖动只改目标组。

### UI-02 · P1 · 保存场景未保存影响计算的模式

位置：`App.tsx:47,72`，`Scenario` 类型。

复现：在 72 小时窗口开启 Published trace only，保存场景；关闭此选项，再加载原场景。保存对象没有 `publishedOnly`，加载也未恢复，旧场景会使用当前全局模式，原来未知的 Concerta 尾部可能变成估算值。图表日期/范围也未保存，重新打开旧场景可能只显示当前日期的空窗口。

修复：将影响计算的模式与必要视图上下文一起保存并恢复，旧备份使用明确兼容默认值。不能只保存模型版本就宣称完整重现；至少覆盖 `publishedOnly`、日期、范围及基线说明。

### UI-03 · P1 · Load example / Snapshot 未完成场景状态切换

位置：`App.tsx:49–50,72`。

复现：开启比较并选择 B，随后点击 Load example。代码只替换 A、设置 example=true，不清除 `comparison` 或返回 A；表单仍显示原来的 B，却写“Example inputs”。Snapshot recorded history 同样仅替换 A。Snapshot 还保留之前 `selectedScenario`，之后 Save 可能更新之前加载的场景，而非新建快照。

修复：为这些入口定义一致的状态转换：替换目标、清理比较或明确保留的规则、当前 A/B、基线、示例状态、保存目标一起处理。重置后表单与曲线必须来自同一个明确场景。Start empty 的现有清理比另外两个入口更完整，可作为参照。

### UI-04 · P1 · 保留的未知历史药品使页面抛错，图表单位也错误

位置：`DoseEditor.tsx:98` 附近的 `getProduct`；`App.tsx:100` History 产品下拉及 favorite 渲染；`TimelineChart.tsx:40`。

服务端接受完整药品快照而不要求 productId 属于当前 catalog，这支持历史/恢复用途。但这些 UI 位置直接调用会抛错的 `getProduct`。用完整有效的历史 dose、只把 productId 改为已下架/旧目录 ID，React 渲染 `DoseEditor` 确认抛出 “Unknown medication product ID”。History 下拉存在同样未防护路径；应用没有覆盖它的错误边界。

同一历史 dose 的 `modelGroup` 返回 relative units，图表却依据组名是否含 `assumptions` 判定单位，使 `unsupported` 组显示“ng/mL · reference plasma model”。独立渲染确认。

修复：历史显示基于保存的名称/剂型/单位快照；未知目录项允许查看，编辑时提示重新核对或仅允许修改非产品字段。轴单位与证据来自模型结构化结果，不通过组名字符串推断。导入一个目录外快照后，应能进入 Today、History、Settings、Scenario 并保留未知模型状态。

### UI-05 · P1 · 读数中的单位与基线说明失去原始含义

位置：`TimelineChart.tsx:66`。

每剂读数硬编码 `{amountMg} mg`。这会把复方仅作为兼容字段保留的第一成分显示成完整剂量，把贴剂的 9 小时标称递送量显示成无上下文的 mg。DoseEditor 已有更准确的复方/贴剂表达，图表需要同步采用。

同时，选择 Snapshot recorded history 后，卡片说明承认含记录快照，但 chart-reading 始终写“Empty starting history is a scenario assumption”，与正在使用的数据相矛盾。基线 snapshot 也没有记录/显示具体截止时刻。

修复：复用药品快照的完整剂量显示逻辑；将基线类型、截至时刻、缺失历史说明作为显式 props/场景字段传入图表。保存/加载与截图应保留同样含义。

### UI-06 · P2 · “Pinned”锁住比例，切换视图后时刻会移动

位置：`TimelineChart.tsx:13–14`。

当前选点保存为窗口内 `position`，`at = start + duration × position`。例如在 Day 的 14:00 固定读数，切换到 48 hours，读数会改到次日 04:00，仍显示 PINNED READING；改变日期或时区也会重新解释比例。

修复：固定读数应保存绝对 instant，在视图包含它时保持同一时刻；范围不含它时明确解除或提示，而不是继续写 pinned。验收同一个 UTC instant 在 Day/48/72 与时区切换后的计算值一致，并且 UI 仍定位该 instant。

### UI-07 · P2 · Custom 长窗口的刻度与采样没有随范围调整

位置：`TimelineChart.tsx:23–25,46–47`。

Custom 允许 31 天，但除 Day 外统一每 12 小时画刻度；31 天生成约 63 个钟点标签和 31 个日标题，在手机和普通桌面都会挤在一起。adaptive W 解决字号随 SVG 缩放，未解决刻度数量。固定 385 个采样点在 31 天窗口约每 1.94 小时采一个点，还可能漏掉较窄峰值；这应明确作为图形分辨率问题处理。

修复：根据可用宽度限制可见标签数量；长窗口主刻度用日期，不重复密集时钟。采样保留关键模型节点/峰值，或限制能可靠展示的范围。至少验证 7 天和 31 天，不只验证 24/48/72 小时。

### UI-08 · P2 · 场景/check-in 保存失败被留在弹窗背后

位置：`App.tsx:47,86–87,127` 附近。

persistScenario 与 check-in 的异常只写入主页面 `error`。原生 modal 打开时，主页面是背景且不可交互，弹窗内部没有对应错误；用户只能看到保存没有完成。Check-in 没有忙碌状态，也可重复点击保存。

修复：在相应弹窗内部显示 `role=alert` 错误并保留输入，保存期间禁用重复提交。账户恢复码页的 Copy 与 “I’ve saved my key” 同样需要成功/失败反馈；后者若 `onUser` 失败，目前无 catch。用冲突/校验失败以及模拟读取失败验证，不能只测成功路径。

### UI-09 · P2 · 关键无障碍/输入语义仍有缺口

位置：`TimelineChart.tsx:63–66`、`DoseEditor.tsx`、`App.tsx` 导航和 `ProfilePage`。

- Reading time 是键盘可操作原生 range，但可访问值只是 0–1000；独立渲染确认没有 `aria-valuetext`。应提供带日期/时区的值，并使读数更新能被理解。
- effect window 的精确端点只有 hover `title`，手机与键盘用户没有同等明确的读取入口。应提供可展开的时间文本。
- Profile 的 12/24 小时偏好影响格式化读数，但所有 `input type=time` 仍由系统浏览器格式决定；没有可控的替代展示。应至少在输入旁显示按偏好解析后的时间，或使用真正尊重偏好的可访问时间组件。
- 手机导航只是移动到屏外的 aside 加 scrim，没有展开状态/导航焦点管理；应检查收起后的项目是否仍可 Tab 到、展开后是否会跳进遮罩背后的主页面。此项需要浏览器键盘验证，不能只从截图判定通过。

## 建议的复核顺序

先修 UI-01 至 UI-05 的场景和语义错误，再用 390 px 与桌面各运行一遍：四剂 → 删除第二剂 → 复制 → B 修改/拖动 → 清空时间 → Load example → Snapshot → 保存加载。在当前流程中检查日期、单位、组别、状态是否始终一致。

接着用 31 天、未知历史药品、保存失败、键盘打开/关闭弹窗、Profile 12/24 切换检查边界。设计参考和尺寸来源见 [design-research.md](design-research.md)；该文件的早期静态问题不能替代当前复核状态。
