# 独立安全审查，第 2 轮：浏览器、加密和本地隐私

日期：2026-09-14。主审指定基线 `f6c01e75c29a24a758c4399f1df114aff7dd4045`，分支 `codex/independent-security-review`，包含第 1 轮未提交修复。本角色为新创建的第 2 轮客户端审查员；先独立读安全相关源码、追踪数据流，再读取第 1 轮报告核对修复。没有先将旧报告或其他代理的判断当作安全结论。

## 结论

独立确认 **3 项中危、均影响 Local 版的隐私生命周期问题**，在主审授权后修复。没有在所查正常 OPAQUE 云端流程中确认新的高危或中危密码泄露、密钥混用、恢复码完整上传或账户明文持久缓存问题。这不是漏洞不存在的证明，也不是第三方安全认证。

本角色修改范围：`src/lib/api.ts`；`src/App.tsx` 的 `signOut`、`resetAccount`、SettingsPage 的账户 key 和 `onDelete` 属性；新增 `tests/local-client-lifecycle.test.mjs`；本报告。没有修改密码学原语、OPAQUE 协议或服务器。App 的 History、Timeline 和其他并行修改属于其他角色。

所有测试均使用合成账号/记录、内存适配器或 localhost 临时 SQLite。没有读取真实浏览器存储、真实密码/密钥/健康记录或生产账户；没有执行 Git、上线、生产认证或负载攻击。

## 实际审查范围

| 路径 | 核对的边界 |
| --- | --- |
| `src/lib/vault-crypto.ts` | 随机 DEK/IV；AES-256-GCM；数据和 wrapped-key AAD；v1 PBKDF2、v2 Argon2id、v3 OPAQUE export/HKDF；严格 owner、canonical base64url、长度、KDF 成本、JSON 形状和累计尺寸；临时字节清理。 |
| `src/lib/opaque-client.ts`、`opaque.worker.ts`、`cloud-opaque-flow.ts`、`crypto-worker-messages.ts`、`vault-kdf.worker.ts` | 四步操作；固定客户端/服务端标识及成本；公共服务端 key 一致性；客户端 exportKey 的用途；一次性 Dedicated Worker；关闭/取消；不可信字段限制。 |
| `src/lib/cloud-client.ts` | 完整读注册、登录、恢复、旧模式迁移、改密码、轮换、账户操作、record/auth 队列、generation、丢 ACK、重试、CAS、owner 绑定、导入/导出、锁定、session。 |
| `src/main.tsx`、`src/lib/api.ts` | 云版挂载前配置；云模式短路 IndexedDB/cache/outbox；Local 的原子事务、cache epoch、读取/写入确认、离线队列、账户切换。 |
| `src/components/CloudGate.tsx`、`src/lib/cloud-session-restore.ts`、`idle-lock.ts` | 重新打开仍锁定；pagehide/BFCache；UI flow 失效；10 分钟闲置；focus/60 秒 session 复查；同步移除云端账户视图。 |
| `src/components/GuestSimulator.tsx`、`src/lib/guest-{workspace,consent,session,storage-lock,transfer,transfer-storage,dose-entry}.ts` | 默认内存；明确的明文设备存储选择；旧数据读取门槛；Web Locks；跨标签快照冲突；撤销 consent；合成记录导入命名空间与重试；精确清除已成功转移副本。 |
| `src/App.tsx`、`src/components/{AuthDialog,CloudSecuritySettings,RecoveryKeyPanel,Modal}.tsx` | 账户视图、明文引用、密码/恢复码、删除/退出、下载、备份预览、组件 handoff/卸载；第 1 轮 AuthDialog 回归。 |
| `src/lib/reports.ts`、`password-policy.mjs`、`src/hooks/useProfilePreferences.ts`、`src/lib/profile-preferences.ts` | CSV 公式前缀转义；JSON 输入大小/结构/领域校验；文件大小检查先于读取；本地密码字典；账户范围内设置回调。 |
| 全 `src` 的副作用与危险输出入口搜索 | storage、cookie、网络、clipboard、下载 URL、HTML 注入、动态执行和外部链接入口。未找到产品代码的任意 HTML 注入或第三方分析上传入口；没有将搜索无命中当作所有依赖均无问题。 |

## R2-C01：退出/删除已成功，设备清理失败却仍显示账户记录

**等级：中危；Local；已修复。**

原 `App.signOut` 顺序是成功注销服务端、修改 account ref、等待 `clearCache`、最后 `resetAccount`。IndexedDB 不可访问，或另一个标签在队列预检查后添加未同步记录，都可令 `clearCache` 拒绝；于是已注销的账户仍显示原 profile、记录和草稿。Local `onDelete` 在确认服务器删除后也先等待设备清理，存在同样问题。

**实际复现：** 用 TypeScript AST 提取并运行当时真实 `signOut` 回调，令 `/auth/logout` 返回成功、`clearCache` 抛出合成 IndexedDB 错误。观察到 effects 只有服务端 logout 和错误提示，`visibleRecordsCleared: false`，而 `accountRef: null`。这证明是异步顺序问题，不需要绕过密码。共享设备上的下一位使用者可能看到本应隐藏的健康记录。

**修复：** 确认服务端退出/删除后立即 `resetAccount`，再清理设备；失败时明确说明退出/删除已完成，但浏览器副本可能仍存在。`resetAccount` 同时将 `dataRef.current` 替换为空数据。SettingsPage 按当前 owner 设置 React key，切换到账户外视图时卸载其密码、删除窗口、outbox 和导入预览等状态。普通退出保留既有未同步工作；仅明确删除账户继续传 `discardPending=true`。认证请求失败或退出预检查发现 pending 时，保留当前账户和未同步工作，不伪称退出成功。

**验证：** 新测试实际执行 App 的回调，覆盖清理失败、清理挂起、退出前 pending、服务端退出失败、删除成功后清理失败、删除失败；检查明文 state/ref 在设备清理之前清空，并检查只有删除允许丢弃 pending。SettingsPage keyed remount 的 React 接线经源码复核，本轮没有将其描述为真实 DOM 跨浏览器测试。

## R2-C02：迟到的 Local `/data` 可重新建立另一标签刚清除的明文缓存

**等级：中危；Local；已修复。**

原 `api.ts` 仅在线 PUT/DELETE 的 cache acknowledgment 检查 `cacheEpoch`；`cacheData` 对 GET 返回的 snapshot 无条件写入。标签 A 已发送 `/data`，标签 B 完成 logout/deletion 和清理，A 的旧 GET 再完成时，A 的 React generation 不会因为 B 的操作改变，因而仍可经过 `fetchAccount` 把旧健康记录重新写入 IndexedDB。这不需要跨账户访问服务器；数据来自清理前已获授权的请求，问题是清除后被重新持久化。

**修复：** Local `/data` 请求前仅读取不含健康数据的 epoch marker，并记录本实例账户 generation。返回对象通过私有 WeakMap 绑定 owner、generation、epoch；`cacheData` 在现有写事务内比较三项，不一致返回 401 并 abort，不能重新创建缓存或向 App 交付陈旧可见数据。WeakMap 不阻止数据被回收，也不增加持久化秘密。正常 snapshot 仍原子合并现有 outbox。

**验证：** 使用两个独立编译的真实 API 模块，共享合成 IndexedDB 事务适配器：暂停 A 的网络回复，B 清除缓存，再释放 A。A 的 `cacheData` 拒绝，缓存保持不存在。同实例账户切换同样拒绝旧 snapshot，另一个账户的 pending 工作保持不变；正常 GET 能保存并覆盖显示 pending。这是事务/回调级测试，非真实浏览器多标签运行。

## R2-C03：Local JSON 备份回复可在退出后启动明文下载

**等级：中危；Local；已修复。**

Settings 的备份回调 `await api('/export')` 后直接创建 Blob 并点击下载链接。原 Local API 对该回复无账户生命周期检查；已发送的 export 在用户退出后才完成，仍将明文交给失去账户作用域的下载回调。第 1 轮处理的是 AuthDialog 迟到登录；本项不是对那个修复的重复统计。更早报告中的 PDF 取消保护也不能覆盖当前 JSON 请求。

**实际复现：** 在修复前运行新 deferred-response 测试：发出合成 `/export` 后 `setActiveAccount(null)`，再释放响应。应取消导出的断言失败，结果为 `Missing expected rejection`，确认旧回复仍成功返回。

**修复：** Local `/export` 同样在发请求前记录 epoch/generation，回复后读取当前 marker；退出、账户切换或另一标签成功清除缓存都会使旧导出拒绝，阻止 Settings 开始下载。已经交给浏览器或已保存的文件不可撤回，仍为明文。

**验证：** 修复后同实例退出、另一标签清除两个分支均返回 401，正常授权导出仍返回原记录。

## 第 1 轮修复复核

完成独立源码检查后读取 `independent-review-round1-client-2026-09-14.md`，核对 C1 的 AuthDialog 修改。当前 close/unmount 均使 flow 失效，迟到登录不再调用父级 `onUser`；已开始父级 handoff 时不接受无法兑现的取消。独立重跑 `auth-dialog-lifecycle.test.mjs`，**4/4 通过**：立即关闭、仅卸载、正常登录、父级加载期间关闭。没有确认该修复的新回归。

该修复仍只阻止当前页面迟到打开数据，不承诺撤销已经由服务端签发的 Local session cookie。这是文档已明确的边界；不能把关闭对话框误说成服务端注销。

## 密码学、恢复与持久化核对结果

- 正常单密码 OPAQUE 路径只发送协议消息，不发送 raw master password；不在失败后回退 raw-password login。Local 和显式旧模式方法本身会向其认证服务器提交相应密码，不能将“所有源码 API 都从不发密码”作为结论。
- 数据 DEK 随机生成；v3 wrapper 由客户端 exportKey 经 HKDF 派生，`info` 绑定用途/协议/owner，未使用 shared session key；数据和 wrapper 的 AAD kind 不同，wrapper 还绑定 KDF 参数。结构检查和领域检查均先于应用恢复。
- 完整 `DTR1` 恢复码包含独立随机账户恢复 token 和 DEK。恢复网络只提交 token 部分；DEK 本地解密。恢复/轮换生成新 DEK 与新 token；改主密码重新包裹同一 DEK，原恢复码按设计保留。
- lock 清除 client 的 key/data/pending；generation 检查阻止迟到加密、解密和网络确认重开。authQueue 保留 cookie 修改顺序，避免旧认证响应覆盖新会话。新设备恢复 session 只恢复身份，CloudGate 仍要求输入密码解锁。
- 云 transport 在应用挂载前启用，cloud cache/outbox helper 均短路；未发现正式账户明文写入 browser persistent storage。Guest 设备存储需单独同意，不能由登录自动授权；加密同步需明确选择，失败保留 guest，成功仅清理被该次选择覆盖的精确设备 snapshot。
- CSV/JSON、恢复码复制/下载由用户主动触发，都是明文副本；CSV 文本已转义公式前缀。外部引用为显式链接，使用 noreferrer；字体、密码字典和 Worker/WASM 来自构建资产，未发现产品代码主动向第三方上传健康记录。

## 测试记录

Node 24，使用已安装依赖：

- 第一批 18 文件共 143 项，其中不需要监听端口的 **133 项通过**；10 项临时 localhost 集成测试第一次因 sandbox `listen EPERM 127.0.0.1` 未能启动，不能记为产品通过。
- 经批准仅开放本机合成 listener 后重跑 `cloud-opaque-client-chain.test.mjs`、`cloud-security-chain.test.mjs`，**10/10 通过**。覆盖真实安装的 OPAQUE/WebCrypto、临时 SQLite、HTTP cookie 顺序、丢 ACK、恢复/轮换、旧 session/旧恢复 token、CAS、加密 Guest 转移。临时数据由测试 cleanup 清除。
- 新 `local-client-lifecycle.test.mjs` **10/10 通过**；同时重跑第 1 轮 AuthDialog 4/4，合计本次覆盖 **153 个不同测试项通过**，不是把重复运行累计成更多独立测试。
- TypeScript `tsc -b` 通过。主审仍须在合并并行编辑后运行最终总检查、构建和部署验证；本报告不证明线上版本与当前源码一致。

第一批文件：`vault-crypto.test.ts`、`opaque-primitives.test.ts`、`crypto-workers.test.ts`、`cloud-client.test.ts`、`cloud-registration-client.test.ts`、`cloud-session-restore.test.ts`、`idle-lock.test.ts`、`guest-consent.test.ts`、`guest-session.test.ts`、`guest-workspace.test.ts`、`guest-storage-lock.test.ts`、`guest-transfer-storage.test.ts`、`guest-transfer.test.ts`、`auth-dialog-lifecycle.test.mjs`、上述 2 个 localhost chain、`reports.test.ts`、`password-policy.test.ts`。

## 残留边界与未覆盖项

1. **可信前端交付。** 服务端/同源其他脚本/供应链若能改写页面，可窃取输入或解锁后的明文；此审查没有证明客户端可抵抗恶意运营者。
2. **完整防回放未实现。** 已知较低 revision 被拒绝，但恶意服务器可给旧密文更高 revision；新实例缺少独立可信 freshness anchor。现有比较不等同于完整防回放协议。
3. **网络活性。** 请求/响应读流无应用级总 deadline；挂起请求可阻塞 authQueue 并延长异步闭包中敏感材料寿命。不能为释放队列而破坏 cookie 顺序；这是既有可用性边界，本轮未重设计协议状态机。
4. **本地清除有范围。** IndexedDB 不可写时不能承诺已擦除设备副本；修复会隐藏当前视图并准确提示。Local 数据库、缓存、outbox 和下载未做 E2EE。另一标签已获得的内存、已开始的下载、剪贴板、扩展、系统备份和 swap 不受当前页面的可靠物理擦除控制。离线未同步工作按既有语义保留，明确删除除外。
5. **撤销并非即时远程擦除。** 云端 open 页每 60 秒/focus 检查会话并空闲 10 分钟锁定；离线且保持活动的页可继续显示已解密副本。旧恢复 key 可解以前保存的旧 ciphertext。
6. **测试范围。** 未完整审计第三方 OPAQUE/Argon2/WASM 实现或证明常数时间；未跑 Safari/Firefox/Chrome 真实 Worker、BFCache、password manager、多标签 UI 矩阵；合成 Worker 测试不等于原生浏览器证明。未独立检查生产 TLS/DB/日志/备份权限、供应链 advisory、真实部署 provenance、临床模型或全部大数据性能；交由相应角色汇总。

这些边界在本报告中保留，不能将“所测路径通过”改写为“所有安全风险已消失”。
