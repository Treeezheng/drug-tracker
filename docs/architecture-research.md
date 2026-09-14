# Dose Timeline：架构与界面研究

研究日期：2026-09-13。本文记录选型依据和实现建议，不把建议写成已经完成的功能。技术能力依据官方文档；论坛只用来了解实际开发者在讨论什么，不能证明市场占有率或性能高低。

## 建议

本机版本采用 **React + TypeScript + Vite，配一个仅监听本机的 Node 服务和 SQLite 数据库**。曲线模型写成独立、确定性的 TypeScript 模块；界面直接运行计算，记录通过 API 存进数据库。图表用 SVG 即可，先不引入完整可视化平台、运行时 AI 服务或大型 UI 套件。

这是针对本产品的选择：主要工作是私人记录、表单、动态图表和历史查询；没有依赖搜索引擎发现的公开内容页，用户希望先在 Mac 上可靠运行。一个静态前端加本机数据库服务能把启动、持久保存和备份做得直接，也保留后续服务器迁移路径。这是根据需求作出的工程判断，不是“Vite 永远比其他框架快”的结论。

原 brief 推荐 Cloudflare Pages + Supabase；技术方向合理，但它属于部署建议。用户这次明确要求先本机运行，因此先提供本机后台。不能要求云账号或邮件服务配置之后才允许用户试用，也不能把浏览器 localStorage 叫作持久后端。

## 官方文档比较

| 选择 | 官方能力 | 本产品的判断 |
| --- | --- | --- |
| React + Vite | React 文档列出 Vite 的 React/TypeScript 起点，同时提醒开发者自行处理路由、数据获取等应用基础设施。Vite 提供开发服务器与静态生产构建。 | 适合高交互私人应用。路由、API 状态和错误处理要明确实现；不把“没有框架”当成自动更简单。 |
| SvelteKit | 可按页面设置 SSR、CSR 和预渲染；官方 Node adapter 可生成独立 Node 服务。 | 同样可行。若团队更熟 Svelte，可直接采用；当前没有足够证据为了本产品改换体系会更好。 |
| Next.js | 支持自托管；官方文档覆盖反向代理、缓存、环境变量、单机与多实例运行。 | 适合需要服务器渲染、公开内容与复杂服务集成的产品。这里用不上主要优势，暂不承担相应配置。并非只能部署到 Vercel。 |
| Astro | 官方定位是内容驱动网站，静态 HTML 优先，按需加入交互 islands。 | 很适合博客、参考资料站或将来的公开介绍页。当前整个中心区域都是交互式应用，优先使用应用前端。 |

依据：[React 从零创建应用](https://react.dev/learn/build-a-react-app-from-scratch)、[Vite 入门](https://vite.dev/guide/)、[SvelteKit 页面选项](https://svelte.dev/docs/kit/page-options)、[SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node)、[Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)、[Astro 定位](https://docs.astro.build/en/concepts/why-astro/)。

React 官方总体上建议优先考虑框架；本项目选择 Vite SPA 是经过需求筛选后的例外，不应错误转述为“React 官方推荐所有人都不用框架”。

SQLite 官方将设备本地数据、低写并发应用列为合适用途。数据库文件应与负责 SQL 的服务放在同一台机器，不让多台设备直接打开网络共享上的同一个 SQLite 文件。未来浏览器经过 API 访问一台服务器，与直接共享数据库文件是不同架构。[SQLite 适用场景](https://www.sqlite.org/whentouse.html)

本机只读环境检查确认：系统 shell 默认找不到 `node`、`npm`；Codex bundled runtime 中的 Node 是 **v24.19.0**，`node:sqlite` 的 `DatabaseSync` 可用。启动器可先找用户安装的兼容 Node，再使用已检测到的本机 runtime 路径，并给没有 runtime 的其他机器明确的安装说明。Vite 当前文档要求 Node 20.19+ 或 22.12+；选定 Node 24 满足此条件。[Vite 运行要求](https://vite.dev/guide/)

`node:sqlite` 省去另装原生 SQLite binding 的步骤，但当前 Node 24 官方文档将这个 Node 模块标为 **1.2 Release candidate**，不应把整个 API 说成完全稳定。应锁定 Node 主版本，使用较小的持久化接口封装，并运行迁移与重启测试；SQLite 数据库引擎本身的成熟度与此 Node API 的稳定级别是不同事情。[Node 24 SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

## 实际网站与论坛给出的启发

Linear 自己的设计文章是克制型工具界面的有用参考。2024 年设计复盘介绍了统一侧栏、页头与面板层级、减少视觉噪音，以及正文 Inter、标题 Inter Display 的选择；2026 年更新进一步降低导航视觉权重，让用户工作的主区域更突出。可以学习布局原则，不照搬品牌、图标或整套视觉外观。[2024 设计复盘](https://linear.app/now/how-we-redesigned-the-linear-ui)、[2026 界面更新](https://linear.app/now/behind-the-latest-design-refresh)

Linear 较早的官方工程文章给出 React 组件实现实例，因此 React 确实曾用于他们的交互界面；这不构成“已经核实 Linear 2026 年整个技术栈”的证据。[Linear 交互菜单实现](https://linear.app/now/invisible-details)

Firebase 博客改版是内容网站使用 Astro 的具体案例。这里参考其采用静态内容架构的场景，不将厂商案例宣传的性能增幅套用到本项目。[Astro / Firebase 案例](https://astro.build/case-studies/firebase/)

论坛检索看到以下方向：

- 2026 年 1 月的 React 社区讨论把私有 dashboard 与需公开索引的文章分开考虑；回复同时提出 Vite SPA、Next.js、React Router framework mode。它反映选择依赖产品类型，而非只有一种“现代 structure”。[讨论原文](https://www.reddit.com/r/reactjs/comments/1q5nq0x/vite_vs_nextjs_for_app_with_auth_dashboard_and/)
- 2026 年 8 月的讨论出现回归 Vite SPA 的声音，也有回复认可 Next/Vercel 的企业部署体验。帖子里存在情绪化表述，不能用赞数推导质量或“大家都在用”。[讨论原文](https://www.reddit.com/r/react/comments/1vjx4o8/nextjs_spa_reality_check/)
- Vite 官方仓库的 2026 年 2 月讨论提到 TanStack CLI 入口变更。这是应查当前官方安装文档、锁定依赖、避免照搬旧教程的实际例子；具体安装命令仍应以相应官方文档为准。[GitHub Discussion #21570](https://github.com/vitejs/vite/discussions/21570)

这些讨论不承担安全配置、医学知识或 API 行为的证据角色。也没有运行跨框架 benchmark，因此不报告虚构的性能排名。

## 代码和数据边界

建议按领域分开 `model`、`catalog`、`time`、`api` 与 UI，保持模型计算不依赖 React、数据库或当前系统时间。每次结果带模型版本、单位和证据状态，测试可以直接给定事件和 UTC 时刻得到结果。

| 数据 | 保存和行为 |
| --- | --- |
| Actual dose | 后台保存；UUID 幂等；精确时间与原始时区；药品、剂型、强度、数量快照；修订记录。 |
| Scenario | 独立于实际记录；Dose 1…N 使用稳定 ID；未填完整日期/时间的行不参与计算；保存时固定模型版本。 |
| Profile | 账户所属；睡眠时间、时区、12/24 小时制；进入任何图表复用相同规则。 |
| Medication registry | 版本化只读产品/来源/模型数据；一条日志对应准确剂型；不凭通用名称推断曲线。 |
| Reports | 指定时间范围和报告时区；历史曲线可读范围外的相关较早剂量，消费总量只计算范围内的 actual events。 |

客户端给出预览与即时曲线反馈；服务器重复验证写入内容与所有权。URL 中的用户 ID 或记录 UUID 不能替代权限检查。保存成功提示只在数据库提交后显示。数据库文件、会话、健康数据和导出应排除在源码版本管理之外。

存储数量时保留十进制字符串或明确精度的整数与单位，避免将二进制浮点误差写成事实记录。液体保留 mg/mL 和 mL；复方保留每一种成分。药物曲线计算可以使用浮点数，但它与输入剂量的精确存储是两个层次。

## 登录与首次使用

建议初始屏幕保持一个安静的登录框，提供 **Sign in**、**Create account** 和 **Explore simulator**。说明“Stored on this Mac”，使用户知道账号和数据属于当前运行的本机服务。不要放未配置的 Google/Apple 登录按钮，也不要把本地账号包装成自动云同步账号。

本机账户可用 email/password 作为登录标识，但未接邮件服务时必须说明 email 尚未验证，不承诺发送重置邮件。可用明确展示并要求保存的恢复码实现本机恢复；导出备份是另一种数据恢复途径，不能只做一个没有后端行为的 “Forgot password” 链接。

建议密码通过内存成本型派生算法保存，不存原始密码；会话使用随机 token、过期时间及服务端撤销。Cookie 使用 `HttpOnly`、合理的 `SameSite`，上线 HTTPS 时设 `Secure`，并校验写入请求的来源。Node 官方提供 `crypto.scrypt` 等密码派生工具；Cookie 属性的实际语义参考 MDN，而不是凭 UI 是否出现锁图标判断安全。[Node Crypto](https://nodejs.org/api/crypto.html)、[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

进入账户后不预填“用户实际吃过的药”。先看到清晰空状态；选择药品、常用强度，睡眠设置可跳过。示例只存在于明确标识的演示 Simulator。常用药保存以后，实际记录主动作应是 **Log a dose**，弹出最后核对后保存，并支持撤销。

## 布局与字体建议

桌面使用窄导航栏，主区域优先容纳图表。Simulator 的日期与 Day / 48 hours / 72 hours 控制放在图表上方同一层；药量列表放图表下方或宽屏右侧。用户增加 Dose 2、Dose 3、Dose 4 时增加稳定的行，不新增成套页面或堆叠特大卡片。

窄屏顺序为日期与视图切换、图表、图例/当前读数、effect windows、dose rows、Add dose。将药品和剂型放一行，强度与数量放下一行，日期与时间并排；重复与删除为次级操作。每行在折叠后仍显示药品、剂量单位和完整日期时间。复杂度增长时先折叠行，不压缩图表高度到不可读。

建议奶白背景、暖灰分隔线、深石墨正文、低饱和青绿色作为主要操作色；图表增加土橙/蓝灰区分剂量。睡眠背景比普通网格明显更暗，但保留曲线对比。证据用短 badge 和线型表达，不让整个页面充满警示框。

字体选择 **IBM Plex Sans 为主体，IBM Plex Mono 只用于时间与数值**，或 Inter 为主体配 IBM Plex Mono。主体不用全等宽。普通控件 14–16 px、正文足够行高、数值 tabular-nums；依靠间距和字重建立层级。自托管实际字体文件及其许可，避免每次打开应用连接字体 CDN。字体选择是设计建议；最终应以真实浏览器下的阅读效果确认。

## 本机到服务器

1. 先交付 Mac 上单条启动路径、数据库迁移、实际登录、保存后重启仍存在、跨账户隔离和本地下载导出。
2. 保留同一个 REST API 契约及模型模块。小规模远程使用可先把同一 Node 服务与 SQLite 放到有持久磁盘的单台服务器，前面配置 HTTPS 反向代理、备份与恢复。不能将 SQLite 文件放在会随部署丢弃的临时磁盘上。
3. 若需要多设备云同步、托管邮件恢复、多实例写入，迁移持久化适配器到 Postgres/Supabase，保留现有 UUID、模型版本和数据迁移脚本。Supabase Auth 提供密码与密码恢复流程；数据授权仍必须实现和验证，不能仅有登录。[Supabase Auth](https://supabase.com/docs/guides/auth/passwords)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
4. Cloudflare Pages 仅承载前端静态产物时，必须另有能存储个人数据的后端。上线前核实当时服务条款、价格和备份策略；本次不创建或购买基础设施。

离线同步是单独的可靠性功能：需要持久 outbox、幂等请求、冲突、删除 tombstone 和恢复后重放测试。只缓存页面资源并不等于已完成离线记录同步。浏览器能打开本机网站也不等于 iPhone 在其他网络能访问；第二设备访问及 HTTPS 属于下一部署阶段。

验证应同时覆盖科学计算与真实使用：已知采样点、跨日连续性、固定坐标轴、未完成的 Dose 排除、日期 DST、四个以上独立行、账号隔离、重复请求、数据库重启、导出单位、390 px 窄屏和键盘操作。构建大小、主要交互响应与加载表现应测量实际产物，不用“轻量框架”替代实际验证。

## 日期与睡眠时间的具体约定

使用 `@js-temporal/polyfill` 实现 IANA 时区与真实时长。实际剂量输入遇到不存在的春季时间时拒绝保存；秋季重复时间必须明确选择较早或较晚的一次。Day / 48 hours / 72 hours 的日历范围按本地日期边界计算，因此 DST 附近两天或三天可能不是精确的 48/72 个经过小时，界面应适当说明。[Temporal 时区与歧义](https://tc39.es/proposal-temporal/docs/timezone.html)、[ZonedDateTime](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)

周末睡眠设置按开始睡眠的日期判断（周六、周日）。23:00–07:00 保留为同一段连续区间；视图从中途开始时仍保留原始起止点，绘图负责裁切。只有重复的目标睡眠边界采用 Temporal 的 compatible 规则：缺失时刻向前移动时钟跳跃的时长；重复时刻使用较早一次，受时钟变化影响的区间显示 `Sleep · clock change`。这是目标日程的显示约定，不会修改实际服药或实际睡眠记录。相同 bedtime/wake time 不被默认为 0 或 24 小时，而是提示改正或关闭设置。
