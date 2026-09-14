# 剂次、时间与医学数据语义 QA

日期：2026-09-13。范围：DoseEditor 的纯函数及静态 HTML、时间和剂量快照边界，并与现有模型、报告、库存、备份及显示范围测试一起回归。主实现另行负责浏览器交互与平台视觉验证。

## 本次结果

- 新增 `tests/dose-editor.test.ts`，25 项全部通过。
- 执行当前全部 TypeScript 测试：**93 项通过，0 失败**。
- 执行 `tsc -b`：通过。
- 测试使用合成记录，不写入用户账户或真实服药历史。

| 检查 | 验证结果 |
| --- | --- |
| 空白选药 | 允许先输入日期和 08:03，药物和剂量仍为空；没有自动记录 Ritalin。 |
| 常用药 | 下拉列表限制到常用药；已选药物即使移除常用设置，也保留；未知旧药显示保存的名称、剂型、规格和厂家，不崩溃。 |
| 换药及规格 | 从贴片换到二甲双胍 ER 后更新为该剂型单位并清除原假设及取下时间；750 mg × 2 片为 1500 mg；普通 ER 不接受渗透泵系列才有的 1000 mg 规格。 |
| 半片 | 10 mg 片、数量 0.5 → 5 mg，数量仍为 0.5；不宣称该产品可以掰开。 |
| 液体 | 0.1 mg/mL × 0.3 mL → 0.03 mg；二甲双胍 100 mg/mL × 5 mL → 500 mg；超出九位小数表示能力的结果保持不完整，不擅自舍入。 |
| 复方与四盐 | Azstarys 两个成分分别保留；Adderall 5 mg 的半片保留四项各 0.625 mg，简短主行显示标签总量 2.5 mg。没有游离碱或效价换算。 |
| 旧记录更正 | 修改数量、备注或时间保留未知药的历史身份和来源快照；不能获得虚构参考模型。清空数量再输入可以从旧记录精确恢复成分量。 |
| ±5/10 分钟 | 08:03 加 5 分钟为 08:08，减 10 分钟为 07:53，不因设置自动取整。空白时间不会自动填入。 |
| Now / 新增行默认时间 | `currentDoseTime(zone, increment, at)` 按显示时区的本地 5/10 分钟档向下取整；不会选未来时刻。Kathmandu 的 45 分钟偏移、历史跳时以及夏令时前后均有确定预期测试。Now 按钮显式使用此函数；新增行默认今天/当前档位由 App 调用。 |
| 跨日与时区 | 验证跨年、闰日、洛杉矶、UTC、东京及 Kathmandu 的 45 分钟偏移；保存的瞬间为时间来源，旅行后陈旧本地字段不会替代它。 |
| 夏令时 | 春季 01:58 加 5 分钟为 03:03；手动不存在的 02:15 被拒绝。秋季可从第一次 01:58 移到第二次 01:03，保留 later 标识与既有秒数；新建重复时刻要求用户选择 occurrence。 |
| 四个独立剂次 | 新行 ID 唯一，编辑不会修改原对象或其他行；显示序号变化不改变输入元素的稳定剂次 ID。实际“删除行”点击行为由浏览器测试覆盖，未用数组过滤的复刻测试冒充交互验证。 |
| 贴片 | 保留 mg/9 h 名义递送依据；非空无效取下时间及早于贴上时间的取下记录不能通过输入检查。取下输入有独立草稿，DST gap/重复时刻错误不修改原记录；重复时刻可选 earlier/later；合法清空可删除取下时间。未更动的可见分钟保留原记录秒数。 |
| 可访问性 | 时间错误设置 role=alert，与日期/时间输入的 aria-invalid、aria-describedby 关联；数量和规格描述保留 mL、mg/mL 等医学单位。静态检查不等于读屏真机验证。 |

## 已修复的真实问题

1. **旧成分记录清空数量后无法恢复。** 旧备份可以只有成分 amountMg、没有 strengthMg。过去第一次清空数量会丢掉重算所需数值。现在先从原成分量与原数量精确恢复可表示的每单位快照，再处理新输入；不从当前药品目录重新生成旧成分身份，不对无法精确表示的结果舍入。
2. **单独修改旧记录时间可能使用缺失或陈旧日期。** updateDose 现在在时间类编辑时先从已保存的 instant 推导该显示时区的日期、时间和 occurrence，再应用修改。备注或数量编辑不会改变真实时刻。
3. **非空无效取下时间缺少本地校验。** 现在会明确提示错误，而不是等待服务端拒绝或把它作为有效时刻使用。
4. **贴片取下输入异常会静默删除旧时间。** 已改为独立输入草稿，合法值才调用 onChange；错误文本通过 role=alert、aria-invalid、aria-describedby 与输入关联，并明确旧值未变。重复时刻提供单独 occurrence 选择，合法空值仍能清空。`updatePatchRemoval` 的真实更新路径覆盖旧记录、两种 UTC 时刻、错误先后关系及清空测试。

## 已报告给主实现的交互风险

这些是代码审查发现；本次纯函数/静态 HTML 测试不证明它们的浏览器交互已经修复。

- `App.markTaken` 原先在请求完成后把旧闭包 `drafts` 整体写回，可能覆盖保存期间对其他草稿的修改。已在当前源码看到主实现采用 `draftsRef.current`、函数式移除及保存期间禁用 fieldset 的修正；慢请求浏览器验证仍以主实现的端到端记录为准。
- 贴片取下 `datetime-local` 的原错误路径已修复并通过纯函数和静态 HTML 检查；各浏览器原生日期时间输入产生的 partial/badInput 事件仍需端到端验证。输入不完整时保留原记录，合法空值才清空。

## 验证边界

执行环境是本机 Node.js 与 React 服务端静态渲染。这些测试验证计算、状态快照、可访问标签及原生时间步长属性，**不等于已经在所有浏览器或真机上测试**。Safari/Chrome/移动端的时间选择器、触摸按钮、图表拖拽、异步保存、账户切换与网络中断仍需主实现的端到端验证记录。测试通过也不是对药物模型个人预测准确性的临床验证。

可重复执行：

```sh
node --import tsx --test tests/dose-editor.test.ts
node --import tsx --test tests/*.test.ts
npm run check
```

## 症状记录与手机时间选择补充（2026-09-13）

新增 `Symptoms.tsx`、`SymptomHistory.tsx`、`lib/symptoms.ts` 及专用样式。主页可记录 Headache、Low appetite、Nausea、Dry mouth、Trouble sleeping，或单独选择 No discomfort。备注可省略，不要求填写原因；每次保存是独立有时刻的 check-in，记录可更正或删除。异步保存成功后才清空，失败保留表单。

`tests/symptoms.test.ts` 新增 **12 项通过**；与现有 25 项 DoseEditor 测试合并执行 **37 项通过，0 失败**，`tsc -b` 通过。验证内容包括：

本次同时执行当时全部 TypeScript 测试：**116 项通过，0 失败**（包括其他代理的时间选择器、症状 CSV 和备份测试；后续新测试以主实现最终结果为准）。

- 多选及 No discomfort 互斥、空选择不能保存、可选备注、手动 08:03 不取整。
- 一天多次报告分别计数，日比较只计一个有明确记录的日；同日先头痛后 No discomfort 不会抹去先前报告。
- 只将 actual/Taken 记录作为同日有服药记录；planned、skipped、simulated 不计入。其他药物不会自动归为所选药物。
- 分母仅包含有症状或明确 No discomfort check-in 的日；缺少记录的日及 legacy focus/sleep/note 不被填成无症状。
- 修改使用同一 ID 最新 revision；旧日期、旧症状和从 Taken 改成 skipped 的旧版本不重复计数。
- 跨时区按报告时区的实际 instant 归日，正确处理 23/25 小时夏令时日。修改秋季第二次 01:33 保留 later occurrence 与原秒数。
- 无观察日显示 “No observed days”，不显示虚构百分比；比较文字明确同日记录不证明因果，“没有 Taken 记录”也不确认没有服药。

DoseEditor 已接入独立 `MobileTimePicker`：桌面原生输入及 ±5/10/Now 保留，手机显示紧凑时间触发按钮。移动选择器 Done 选择与现有分钟相同时不触发记录变更，避免抹去原秒数或重复时刻标识。CSS 显示断点与真实触摸交互由主实现及选择器作者验证；本节不宣称 iPhone 真机或全部浏览器已测试。

## 数量步进补充（2026-09-13）

Quantity 增加紧凑的 − / 输入框 / +，手机按钮触摸区域为 44 × 44 px。键盘上下键使用相同步长；直接输入仍保留原小数精度，不把实际记录的 1.5 片改成整数。边界按钮不能生成零、负数、非十进制或超过原输入上限 10000 的结果。

默认按钮步长按具体品牌、剂型、规格核对，而不是按 `tablet` 一概推断可分片：

| 产品/规格 | 按钮步长依据 |
| --- | --- |
| Ritalin IR 10 / 20 mg | 每次 0.5 片；[参考标签 §3 与产品特征](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c0bf0835-6a2f-4067-a158-8b86c4b0668a) 描述 bisection / 两部分。5 mg 无刻痕，步长保持 1。 |
| Adderall IR 各已列规格 | 每次 0.5 片；[参考标签 How Supplied 和产品特征](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f22635fe-821d-4cde-aa12-419f8b53db81) 标示 bisects / 四部分；UI 未据此提供四分之一片快捷步长。 |
| QuilliChew ER 20 / 30 mg | 每次 0.5 片；[标签 §2.2 与 Medication Guide](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=defc1205-8e90-4b1e-b862-05e4c35c7364) 明确可沿功能刻痕半分。40 mg 明确不能分，步长 1。 |
| Dyanavel XR tablet 5 mg | 每次 0.5 片；[标签 §2.3](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ae304b29-0b40-40ec-ad0d-76b742d4a9b9) 明确可均分；10 / 15 / 20 mg 步长 1。 |
| 其他未核对标签的片剂、generic family、胶囊、贴片 | 步长 1；不会继承另一品牌/规格的分片规则。 |
| 液体 | 输入便利步长 0.1 mL；不表示测量器具精度，也不改变既有更细的小数记录。 |

分片是否适合用户手中的实际包装仍由其标签决定；[FDA 说明](https://www.fda.gov/drugs/buying-using-medicine-safely/tablet-splitting) 不支持把一种产品的分片规则直接移植到另一产品。按钮用于记录数量，不自动建议增加服药量。原有 fractional-solid `unusual` 标记及标准完整片模型限制保留。

新增 4 项实际边界/集成测试。DoseEditor 共 29 项与库存 12 项合并执行 **41 项全部通过**：Ritalin 10 mg 从 1 点击增加为 1.5 片，标签量准确为 15 mg；30 片库存准确余 28.5。Adderall 5 mg × 1.5 为四盐标签总量 7.5 mg，每个成分 1.875 mg；液体 0.3 + 0.1 为精确 0.4，不出现浮点尾数。服务端与 CSV 已由后端代理核对支持保存 `quantity="1.5"`、`amountMg="15"`，并分别保留数量和药量。

## Read-only Formula disclosure — 13 September 2026

The dose editor now separates read-only Formula from optional Record details. Formula uses constants shared with the existing model: Ritalin’s constructed biexponential reference, Concerta’s interpolation of digitized points and its explicitly conditional estimated tail. Unverified products, custom packages that merely sum to the reference dose, unavailable model versions and incomplete amounts do not acquire a verified formula. Existing accepted arbitrary illustrations remain readable as unvalidated relative shapes; their saved fields are preserved through note/time/package-detail corrections. The editor no longer offers assumption inputs or an acceptance switch. Patch removal, DST occurrence/error handling, altered administration, manufacturer, notes and ingredient snapshots remain in Record details.

Five new formula tests verify the displayed parameters against real numerical anchors and interpolation/tail behavior, prohibit formula inheritance, preserve legacy illustrations, and check that Formula is a separate collapsed disclosure without editable controls or render-time record changes. These five plus existing DoseEditor/custom-strength/model tests passed 62/62; TypeScript passed. A later formula-only rerun also passed after adding the incomplete-amount guard. Stable toggle position is implemented by anchoring the native summary in a footer independent of open state; root browser QA, rather than this static/unit report, verifies its measured screen position.
