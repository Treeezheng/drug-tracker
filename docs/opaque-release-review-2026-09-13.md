# 单密码 OPAQUE 候选版本复核

日期：2026-09-13。执行：OpenAI Codex（GPT-6），实现侧源码审查及合成数据测试。**这不是独立专业安全审计、认证、OPAQUE 库作者对本应用的认可，或新版本已部署的证明。** 未读取、导出或试验用户生产数据库。

## 发布身份

网站此前已经运行；本文件记录之后的单密码改造，不能混用旧站、工作区和新构建的证据。**精确发布证据以本次变更 PR 的最终验证评论及其关联 main CI、构建 manifest 和 provenance 为准。** 发布负责人在 PR 可用后追加其链接，并在验证评论中记录 source commit、测试 run、扫描结果、云构建摘要、GitHub attestation 与实际部署资产的对应关系及核验时间，避免候选文档自引用尚未包含自身的 commit。

本文是候选行为与复核范围说明，**自身不证明已部署**。修改源码或提供服务器自报 commit 字符串不等于完成核验；旧认证流程的测试数量也不能替代本次结果。政策版本为 2026-09-13，PRIVACY/TERMS 与 public HTML 须进入同一发布工件。

## 当前代码与用户流程

- **一个密码。** 注册、登录与重新解锁使用 OPAQUE。生产公开入口不提供旧原始密码认证或迁移向导；底层旧格式兼容测试不代表公开功能。新密码不以明文或普通 hash 形式发送给服务器，服务器保存 OPAQUE 注册记录。
- **认证与数据密钥分离。** `@serenity-kit/opaque` 固定为 1.1.0。浏览器 OPAQUE 拉伸参数为 Argon2id 65,536 KiB、3 次、并行度 1；v3 包装由 client-only export key 经 HKDF-SHA256 派生，绑定用途及 owner。双方共享的 session key 不用于包装数据密钥。健康快照使用随机 256 位数据密钥、AES-256-GCM，每次新加密取新的 96 位 nonce。数据 envelope 仍为 v1；其版本与 wrapped-key v3 不应混淆。
- **一个完整恢复码。** `DTR1` 包含账户标识、随机 32 字节恢复认证凭证、独立的 32 字节数据密钥。服务端只保存认证凭证的 SHA-256；恢复时只传认证部分，完整码与数据密钥部分留在浏览器。持有码可在不知道旧密码时恢复账户和数据，因此它是替代凭证，不是第二认证因素。
- **保存责任。** 注册或换新码后，界面必须勾选已保存及理解责任才能继续。复制/下载提供明确反馈，但不能证明外部副本已保存或日后可读取；下载文件是明文。运营者不保管可用完整码；密码和恢复码都丢失时，没有客服或邮箱绕过解密的恢复方式。
- **更换与恢复。** Change password 重新包装同一数据密钥，原恢复码仍有效。Replace recovery key 和账户恢复生成新数据密钥、重加密当前快照并给出新码。凭证操作与 vault revision 通过事务/CAS 一并提交，撤销旧会话。错误凭证、冲突、失败或丢失响应不得悄悄替换记录；取消/锁定须防止迟到结果重新打开旧账户。
- **其他边界。** 会话 24 小时绝对上限，账户页面无活动 10 分钟锁定；没有持久明文账户缓存或离线 outbox。访客默认内存，主动记住后才独立明文 localStorage。Guest Add 只折叠 simulated 行；登录后的 Sync guest simulation 需明确选择，成功加密提交确认后才清当前内存及匹配的本地副本，失败或跨标签页变化不悄悄删除。同步状态仍是 simulated，不当作 Taken。计划到时的 Taken 是可关闭的快捷入口，仍需人工核对实际服药时间并确认。

对应源码：[OPAQUE 客户端](../src/lib/opaque-client.ts)、[认证流程](../src/lib/cloud-opaque-flow.ts)、[加密](../src/lib/vault-crypto.ts)、[业务客户端](../src/lib/cloud-client.ts)、[云服务](../server/cloud-opaque.mjs)、[恢复码界面](../src/components/RecoveryKeyPanel.tsx)。具体协议与实现测试结果由对应实现文档继续记录：[协议](opaque-protocol-v1.md)、[客户端](cloud-client-design.md)、[加密](vault-crypto-design.md)。

## 本次独立复核证据

[opaque-primitives.test.ts](../tests/opaque-primitives.test.ts) 的 **7 项测试通过**：调用真实依赖完成注册与重复登录、client export key 的稳定恢复、共享 session key 无法解包、错误密码/身份失败、v3 严格验证和 owner/AAD 隔离、独立恢复认证部分与数据密钥及 SHA-256 验证、取消操作。它不等于真实 HTTP、PostgreSQL、生产 TLS 或浏览器部署的端到端审计；组合测试由对应实现者及最终发布流水线另外记录。

计划确认相关 **27 项 TypeScript 测试与 2 项真实本地 API 测试通过**，使用临时合成数据库：到期本身不修改 Planned 状态、关闭快捷入口不禁用 Edit、确认默认原计划时间而非伪造现在、DST 错误需更正、保存失败可重试、profile 开关可保存/导出/恢复且拒绝错误类型。这属于数据正确性复核，不是医学有效性证明。

PRIVACY、TERMS、README、SECURITY、法律复核与事件流程已经按新代码统一；政策 HTML 为无 JavaScript 静态页，由对应 Markdown 同步。最终打包前须再核对它们确实进入同一发布工件。

### 访客同步的后续复核

只读检查 [CloudGate](../src/components/CloudGate.tsx) 后，修正了提前验证空剂量导致恢复码确认页无法继续、锁定后重试更换同步 namespace、同步期间 401 未清除账户密钥的问题。当前 Gate 先显示选择，只有点击 Sync 才验证和提交；Keep separate 不触发导入。确认的 transfer input 按 owner 与访客快照绑定，在同页锁定后保留以便幂等重试，包含访客资料而不包含账户解密密钥。已上传标志不跨认证流程继承，其他账户不能沿用它跳过保存。

[guest-storage-lock.test.ts](../tests/guest-storage-lock.test.ts) 新增 **4 项通过**：用合成 Web Locks 调度器验证 save → cleanup 与 cleanup → save 两个次序、失败释放锁及缺少 Web Locks 时拒绝无保护的写入。连同 [guest-transfer-storage.test.ts](../tests/guest-transfer-storage.test.ts) 共 **8 项通过**。该证据验证共享锁契约及精确副本检查，**不是实际双浏览器并发实测**；安全顺序要求所有参与的当前应用保存、同意选择及清理路径使用同一锁，旧版本或其他同源脚本不受此合作协议约束。

后续源码复核确认 GuestSimulator 的自动保存、记住设备选择与 Clear，以及 Gate 的同步后清理都使用该共享锁；排队的保存会在执行时重查 consent。`restoreGuestSession` 在 Keep separate 后恢复父组件保存的访客内存；若它与现有设备副本不同，关闭自动保存并提示，不因恢复旧内存直接覆写另一标签页副本。该判断为源码复核，调用方完整测试仍归对应实现者与最终流水线。

客户端实现者另外记录了实际加密导入、CAS/丢 ACK 对账、提交后锁定并重新登录重试的测试；这些属于对应[客户端记录](cloud-client-design.md)，不与这里的单元测试数相加冒充统一端到端运行。最终生产发布以 PR 验证评论关联的版本与构建证据为准。

### 本机界面与图表证据

Root 在本机开发构建中检查 Concerta → Adderall → Concerta 切换：同一选择控件的视口 Y 为 **497.66 / 497.77 / 497.66 px**，页面滚动位置为 **1073 → 625 → 1073**；切换补偿保持选择控件位置稳定。这是本机浏览器观察，不是生产资产、所有设备或所有滚动场景的证明。

[timeline-reference-paths.test.ts](../tests/timeline-reference-paths.test.ts) 的 **6 项图表回归通过**：72 小时 Concerta 观测主体实线、约 30 小时后的估计尾段单独虚线；published-only 仍截断；Generic Ritalin 参照虚线不填补真实未知浓度、不累加到已知总量；完全无模型药物不制造浓度曲线；显示的参照带齐 S2/S3 来源。连同 scope/overlay/unknown/empty 相关测试共 27 项通过。该测试检查真实 SSR 标记与模型结果，不代替目视绘图或医学有效性研究。

## 仍然成立的风险与证据限制

- 运营者或被入侵的部署链可以修改交付的 JavaScript，读取用户输入的密码、完整恢复码或解锁数据。开源、HTTPS、OPAQUE、浏览器加密与构建摘要不能消除这一风险；同源其他页面、扩展和设备也在信任范围内。
- OPAQUE 服务器 setup secret 与认证记录仍是敏感资料。两者在当前部署中都由数据库保存，并非独立隔离；一并泄露可允许针对弱密码的离线猜测。正常重启不得重建 setup；恢复备份不能复活旧认证版本、恢复凭证或会话。
- 用户名、认证/恢复验证记录、临时协议状态、会话、密文大小/时间及连接元数据不被健康快照加密。Heroku/Salesforce 的基础设施和 NEL 数据另有处理；不声称没有元数据、不需要泄露通知或已确定所有副本的删除期限。
- 当前服务器可拒绝服务或返回以前有效的密文；本设计不提供恶意服务器回滚的完整防护。轮换只保护新版本，不能收回已复制的旧密文/密钥或任何明文导出。恢复码确认也不是实际备份可恢复性测试。
- 原 Claude 报告保留原始范围；旧双密码阶段的测试结果不自动验证本次替换。用户提供的本地开发 Lighthouse PDF 是其开发页面的性能/可访问性检查，不能作为密码学、生产安全或法律认证。

## 一手依据

OPAQUE 的公开规范说明密码隐藏与服务器受损后的猜测边界，并单列 client export key 用途；它是 CFRG/IRTF 信息性 RFC，不应称为本应用获得的安全认证。[RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)

库的官方集成说明要求保留服务器 setup；本应用采用现成实现不等于应用集成已获得库自身审计的覆盖。[Serenity OPAQUE 源码与说明](https://github.com/serenity-kit/opaque)

HKDF 的上下文信息用于将派生密钥绑定到具体用途。[RFC 5869 §3.2](https://www.rfc-editor.org/rfc/rfc5869.html#section-3.2) 网站信任与运营事件边界另外见 [SECURITY](../SECURITY.md)、[隐私政策](../PRIVACY.md) 和[事件响应](incident-response-runbook.md)。
