# Dose Timeline：设计依据与三页面收敛

研究更新：2026-09-13。本文以用户最新要求为准：三个页面、less is more、白灰背景、少量蓝色、接近 Apple 工具界面的安静感。早期的橄榄绿、营销标题、侧栏和多页面建议已撤回。这里记录官方来源、选择理由和可检查的实施结果；不是声称获得 Apple/Google 认证。

## 官方规范实际支持什么

| 官方来源 | 核实到的原则 | 本产品采用 |
| --- | --- | --- |
| [Apple HIG Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | 用字号、字重、颜色建立层级；少字体；小字避免 Thin/Light 等细字重；文字放大后仍需保持层级和可读布局。 | Inter 作为唯一主要界面字体，400 正文、500 控件、600 标题；数值用 tabular numbers。没有为了“Apple 味”另装字体、使用极细字或缩小辅助文字。 |
| [Apple HIG Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) | 保留必要内容、简洁措辞、清楚结构、熟悉行为，并帮助用户从错误中恢复。 | 页面直接叫 Dose Simulation、History、Settings；动作直接叫 Add dose、Taken、Save。停止使用广告式副标题。 |
| [Apple HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) | 顶层导航应稳定、数量适当；标签表示去哪里，动作放在相关视图中；空内容不能让导航项消失。 | 三个导航项始终可见，手机仍能直接切换；Add dose 放在剂量列表附近，不混进导航。 |
| [Apple HIG Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls) | 常用信息保持可见，高级内容在相关时展开；展开控件靠近内容，标签说明会展开什么。 | 常用药、剂量、日期、时间、Taken 保留；模型参数、来源、睡眠读数、补货明细及备份细节逐步展开。 |
| [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 对齐表达关系；相关控件分组；给控件足够空间，按可用尺寸调整布局。 | 桌面剂量行对齐，手机药品占一行、强度/数量并排；更窄时日期与时间分行。保持必要单位完整可见。 |
| [Google 官方 Material 3 实现文档](https://developer.android.com/develop/ui/compose/designsystems/material3) | Typography 以 display/headline/title/body/label 划分角色，产品不必用全部 15 种样式；示例明确可以只选少数。文档也区分高/低强调按钮及紧凑设备的导航。 | 只保留少量标题/正文/标签角色；一个主操作，其余采用普通文字或轻描边。借鉴角色体系，不引入完整 Material 组件库。 |
| [IBM Carbon Typography](https://carbondesignsystem.com/elements/typography/type-sets/)、[Forms](https://carbondesignsystem.com/patterns/forms-pattern/) | 产品正文有 14 px 基础，标签 12/14 px；相关字段可以少量并排，其他按逻辑分组。 | 桌面正文/字段 14 px，手机输入 16 px，标签 12 px；不为了塞下同一行持续缩字。 |

Material 3 主站部分页面要求 JavaScript，本次无法完整提取；相关结论使用 Google 自己的 Compose Material 3 文档，明确区分设计角色与 Android `sp/dp`、Apple `pt`、网页 CSS px。没有将原生尺寸机械当作网页法定要求。

## 三页面的重点与减法

| 页面 | 第一眼应该看到 | 收进相关折叠区或次级入口 |
| --- | --- | --- |
| Dose Simulation | 日期、图表、独立剂量行；每行的明确 Taken 动作；列表末尾 Add dose。 | 每剂参数、完整来源、effect/sleep 细节、保存计划。移除页标题旁与列表末尾重复的主添加按钮。 |
| History | 选定时期、每药独立 mg/成分汇总、每日柱状图。 | 原始逐条记录、按包装强度细分、下载入口。不能把不同成分或贴剂名义递送量混成一个数字。 |
| Settings | 常用药、个人时间/睡眠偏好、当前库存。 | 收货录入与收货历史、低频的显示设置、备份、账户删除和方法说明。库存优先显示余额，收货表单按需展开。 |

这些是对 App 结构的具体建议。CSS 不通过 `display:none` 偷偷移除仍可操作的功能，也不以减少信息为由隐藏药品单位、实际/未记录状态、未知模型状态或错误。

## 当前样式选择

正文 Inter 14 px / 21 px；按钮 14 px / 500；字段标签 12 px / 400；卡片标题 18 px / 600；页面标题 28 px / 600。移动端输入 16 px，常规触摸操作 44 px。模型数字使用与正文一致的字体及等宽数字；IBM Plex Mono 仅作为少数代码/技术内容的备用角色。

配色收敛到浅灰底 `#f5f5f7`、白色内容区、正文 `#1d1d1f`、次级文字 `#60656d`、蓝色 `#426a95`。正文对白约 16.83:1；次级文字对白约 5.87:1，对浅灰底约 5.39:1；白字蓝按钮约 5.63:1。计算基于明确的 sRGB 纯色配对，实际透明度、背景和状态仍需浏览器确认。[W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

视觉层级依靠内容宽度、24 px 分组间距、标题字重和轻边框。导航选中状态使用浅灰底，主要按钮使用蓝色；没有每个卡片悬浮阴影、装饰渐变、进入动画或重复的全大写眉题。Apple 的“简洁”原则不要求模仿 Liquid Glass；本地记录工具没有必要增加模糊层和动画成本。

本轮样式修正还包括：Time 标签与其他字段标签统一；±5/10 min 成对控件位于时间输入下方，避免把其他输入挤向不同基线；页面参考文献按条目分行；Custom 日期区有明确分组；分类药品弹窗的复选标签与强度字段按各自布局，不让通用 label 样式互相覆盖；库存药名使用正文，余额才是数值重点；收货表单避免在手机上出现嵌套的四列输入。

## GitHub 上的设计 Skills：已读源码，未安装

读取日期同上。Star 是整个仓库的关注量，不是某个 skill 的安装量、真实用户数或质量保证。GitHub 数值会变化，下面仅记录这次可核实的快照。

| 仓库/原文 | 热度与维护证据 | 针对本项目的判断 |
| --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) 的 [frontend-design/SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 仓库页面显示 **176.1k stars**；[该文件历史](https://github.com/anthropics/skills/commits/main/skills/frontend-design/SKILL.md) 最近列出 2026-09-03 更新，提交 `41bbe19`。 | 当前源码强调有意选择、用户需求优先、少字体、一个重点、删除无用装饰、直白文案和截图自审。适合借鉴，不能据旧版本印象宣称它“禁止 Inter”。 |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) 的 [web-design-guidelines/SKILL.md](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) | [GitHub API](https://api.github.com/repos/vercel-labs/agent-skills) 返回 **31,160 stars**、`archived:false`、仓库最后推送 2026-08-28；[入口文件历史](https://github.com/vercel-labs/agent-skills/commits/main/skills/web-design-guidelines/SKILL.md) 最近列出 2026-01-16。 | 这是审查入口，实际规则来自另一份文档；仓库推送时间不能当作每条设计规则的更新时间。更适合验证实现底线，不是整套审美风格。 |

也直接读了 Vercel skill 指向的 [Web Interface Guidelines 源码](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md)。本项目采用其中的原生语义、可见焦点、输入标签、数字对齐、按时区格式化、窄屏溢出检查和减少动效；涉及自动加导航警告或其他扩展功能的通用建议，仍按具体任务筛选。

Anthropic 原文对模板化眉题、每处都用等宽小标签、重复营销表达和到处出现的装饰边框提出自审要求。本项目据此让图表成为一个重点，其余是普通可读表单。它鼓励有意识的风格探索，但这里已经有明确的克制方向，因此不采用额外大标题、特殊字体、视觉噱头或页面进入动画。用户的取舍优先于外部 skill 的通用审美倾向。

本次仅学习与核对公开文本，没有安装 skill/plugin、执行外部脚本、运行其部署流程或上传项目。外部文件中的工作流指令被作为研究材料阅读，不提升为本任务的授权。

## 自审与验证边界

CSS 已通过实际 PostCSS 解析。静态自审覆盖新增 class、时间调整对齐、三页导航、长参考链接、分类药品选择和库存表单。设计上的完整验收继续依靠主执行者的浏览器实测：桌面、390/360/320 CSS px、四剂操作、两种时制、展开/收起、键盘焦点与失败反馈。语法通过不能证明外观已经通过，桌面响应式模拟也不能替代真实 iPhone Safari。

早期八页面/A-B 场景的交叉审查证据保存在 [cross-review-ui.md](cross-review-ui.md)，其问题属于重构前快照，不作为当前页面缺陷清单。最初的框架与论坛研究保存在 [architecture-research.md](architecture-research.md)。
