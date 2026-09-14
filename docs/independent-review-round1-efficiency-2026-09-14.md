# 第一轮效率与发布核对

日期：2026-09-14。主审查者直接检查当前实现及合成性能测量；本文件不冒充新的独立 Agent 报告。三名无会话历史的第一轮 Agent 分别覆盖服务端、客户端、隐私与合规。后续另派新 Agent 进行第二轮。

## 发布起点

开始审查时，GitHub main 与 Heroku v10 的源提交均为 `f6c01e75c29a24a758c4399f1df114aff7dd4045`。2026-09-14 07:28:21.934 UTC，公开页面可访问，根路径 302 到 `/drug/`，32 个部署文件的字节数与 SHA-256 都匹配该 main 的 CI 构建。CI 与 Heroku 的 Node 补丁版本和构建 dirty 元数据不同；没有声称两个 manifest JSON 完全一致。这是审查前的发布证据，后续版本必须重新核对。

## E1 · P2 · 图表在时钟和指针更新时重复计算所有曲线

检查路径：`src/App.tsx`、`GuestSimulator.tsx`、`TimelineChart.tsx`、`timeline-scope.ts`、`timeline-estimates.ts`、`timeline-data.ts`、`timeline-legend.ts`、`model.ts`、`dose-entry-status.ts`。

旧实现每次 render 为每个 analyte 计算 289 个总量样本，并再次为每条单独曲线计算相同的贡献。账户页面的一秒时钟持续创建新的 scope 数组。拖动读数也重复采样，即使药量、时间窗和模型没有变化。该工作直接占用浏览器主线程。大数组被展开给 Math.max；输入增长时还可能触及 JavaScript 参数数量上限。

修复：

- 账户／guest 的不可变记录分区和时间窗口按依赖复用，保存、编辑、换日期／时区后正确失效。
- 图表按记录和时间窗保留样本；改变宽度只重建几何，改变读数只计算当前读数。
- 同一总量采样已经计算出的贡献同时供单条曲线使用，避免重复求值；不为纯时间轴生成浓度采样。
- 样本只保存绘图需要的总量标志和数字，不在 289 个时间点各保留完整模型对象；以循环求最大值。缓存归属当前组件，无全局健康记录缓存，卸载即释放应用引用。
- 不删除历史、不把未知值当零、不相加不同单位、不更改直接证据与参考估计的区别。没有通过取消 Planned clock 更新提高性能。

## 测量

合成输入使用 UTC 2026-09-14，每 8 小时一条 generic methylphenidate IR 10 mg 历史记录。所有保留的记录属于同一 analyte。没有使用用户健康记录。

| 场景 | 基线 | 修改后 |
| --- | ---: | ---: |
| 同一个已挂载图表，100 条记录，20 次 parent clock 更新的 React 渲染中位数 | 410.3 ms | 13.0 ms |
| 上述 20 次最大值 | 439.9 ms | 27.8 ms |
| Node SSR 首次渲染，100 条，3 次中位数 | 507.5 ms | 339.6 ms |
| Node SSR 首次渲染，365 条，3 次中位数 | 1850.0 ms | 1246.2 ms |

React Profiler 使用本机浏览器开发构建，Node SSR 为独立进程测试。它们不是 iPhone 真机或生产端到端延迟数据，不能把结果外推成所有设备的保证。首次加载和大量记录编辑仍随输入规模增加；保留精确历史与未知语义优先于静默裁剪。旧与新 SSR 数个字节差异来自等价浮点坐标舍入。已对真实样本和曲线路径作回归。

本地复核材料：`artifacts/audit-timeline-benchmark.tsx`、`audit-timeline-ui.html`／`.tsx`、`audit-timeline-browser-result.json`；这些是忽略的临时审查材料，不作为产品公开资产发布。

## 其他验证与有效性检查

- `tests/timeline-series.test.ts` 检查直接参考、按剂量缩放、不同 analyte、未知输入、未来给药、相对单位及观测边界前后，保证共享样本与既有计算含义一致；验证未知端点不被连接、1000 条路径的几何不会使用无限参数展开。
- 现有图表回归检查 72 h 观测/估计分段、generic 星号、不可建模药物仅显示时间、键盘/触摸映射和空状态。
- `model-formula.test.ts` 原测试只接受旧无尾部说明，已改为核对观测末点、默认继续衰减一个半衰期值为末点的一半，以及 published-only 仍无外推。不是为了让旧字符串通过而跳过实际行为。
- 当前锁定依赖的 `pnpm audit --json`：105 total dependencies，已知 info/low/moderate/high/critical 均 0；未发现已知公告不等于没有未知漏洞，不替代 OPAQUE/WASM 密码学审计。
- 对本地可达 Git 历史的 441 个小于 2 MB 非二进制 blob 作常见私钥、GitHub token、AWS access key、Stripe live key 格式扫描，0 匹配；另有 83 个较大／二进制／其他对象未覆盖。GitHub secret-scanning alerts API 返回空列表。两者均不是任意格式秘密或所有历史的无泄露证明。
- TypeScript 严格检查启用 noUnusedLocals／noUnusedParameters；没有为了声称清理冗余而删除本地版、医学未知值分支、回滚检查或现有恢复保护。

最终测试总数、第二轮问题和部署证据见本次总报告；本文件只保留第一轮发现与局部验证边界。
