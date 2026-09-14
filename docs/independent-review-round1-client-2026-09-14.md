# 独立安全审查，第 1 轮：浏览器加密与隐私

日期：2026-09-14。审查角色：独立客户端审查员。审查起点由主审指定为 `main f6c01e75c29a24a758c4399f1df114aff7dd4045`，工作分支为 `codex/independent-security-review`；本审查员未执行 Git 命令，也未把其他审查报告或先前结论当作证据。

## 结论与范围

发现并复现 **1 项中危、仅影响 Local 版的隐私竞态（C1）**，已按主审后续指示修复，并增加 4 个针对性回归测试。对本轮实际覆盖的云端客户端路径，没有确认新的高危或中危漏洞。此结论不是对全部系统、部署状态或第三方密码学实现的安全保证。

所有运行验证均使用临时合成凭据、内存 mock 和本机源码。未连接生产服务、未读取或写入生产账户/健康数据、未部署。最初只读审查完成后，主审明确授权修改 `src/components/AuthDialog.tsx` 和新增回归测试；未修改其他产品文件。

### 实际覆盖路径

| 路径 | 审查内容与结论 |
|---|---|
| `src/lib/vault-crypto.ts` | 完整检查 key 创建、v1 PBKDF2/v2 Argon2id/v3 OPAQUE 包裹、恢复码、HKDF、AAD、AES-GCM、严格 envelope/JSON 验证、大小限制、随机 IV、错误归一化、临时字节清理。 |
| `src/lib/opaque-client.ts`、`cloud-opaque-flow.ts` | 注册与登录四步协议、固定服务端标识/用户名、公共 key 一致性、固定 Argon2id 参数、exportKey 返回路径；未见单密码流程回退到 raw-password API。 |
| `src/lib/opaque.worker.ts`、`vault-kdf.worker.ts`、`crypto-worker-messages.ts` | Dedicated Worker 全局与私有消息端口、一次性执行、严格请求形状、长度/成本限制、终止/取消路径、共享缓冲区拒绝；浏览器原生 Worker 事件行为未在本轮真实浏览器中重跑。 |
| `src/lib/cloud-client.ts` | 全文追踪注册/登录/恢复/legacy 迁移、改密码、轮换、setup/save/security 丢 ACK、原样重试、owner 校验、record/auth 双队列、generation、lock/logout/session、解密后领域校验、快照导入导出。 |
| `src/lib/api.ts`、`src/main.tsx` | cloud edition 入口在挂载前切换 transport；cloud 的 cache/outbox 路径短路，无健康记录写入 IndexedDB。另检查 local IndexedDB 缓存/队列/epoch/清除逻辑及与云版的区别；未宣称 Local 数据 E2EE。 |
| `src/components/CloudGate.tsx`、`src/lib/cloud-session-restore.ts`、`idle-lock.ts` | restore 仅恢复服务端身份；重开仍要输入密码；flow/generation、迟到响应、pagehide/BFCache、10 分钟空闲锁定、focus/session 复查、sign-out 的同步卸载、Guest 选择/迁移/清除。 |
| `src/components/GuestSimulator.tsx`、`src/lib/guest-{workspace,consent,session,storage-lock,transfer,transfer-storage,dose-entry}.ts` | 无授权不持久化；Web Locks 缺失时拒绝写存储；精确快照对比；撤销 consent 后清除；跨标签不覆盖更新；仅迁移 simulated 数据；稳定 namespace 的重试幂等；失败保留副本。 |
| `src/App.tsx`、`src/components/{AuthDialog,CloudSecuritySettings,RecoveryKeyPanel,Modal}.tsx`、`src/hooks/useProfilePreferences.ts`、`src/lib/profile-preferences.ts` | 账户/组件生命周期、迟到的私密数据、备份/恢复预览、恢复码显示/复制/下载、密码表单、父级 handoff。AuthDialog 找到 C1。 |
| `src/lib/reports.ts`、`password-policy.mjs`、`favorites.ts` | 备份 UTF-8/深度/字段/数量/原型字段约束，恢复前领域校验，CSV 公式前缀转义，密码策略在本地字典执行。 |
| 全 `src` 的危险输出/副作用入口搜索 | 检索 HTML 注入、eval/Function、document.write、storage、clipboard、URL/DOM、网络/Worker 等入口，并追踪命中的安全相关路径。未找到产品代码 `dangerouslySetInnerHTML`、`innerHTML`、任意字符串执行或第三方分析上报；医学模型/时间计算正确性并非本角色的完整审计范围。 |
| `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`vite.config.ts`、`scripts/{build-metadata.ts,heroku-build.mjs}`、`.github/workflows/ci.yml`、`server/cloud.mjs` 安全头/静态资源段 | `@serenity-kit/opaque` 固定 1.1.0，实际 lock 中 `hash-wasm` 4.12.0；字体/WASM/字典本地打包；CI frozen lockfile、Action commit pin、构建比对与 provenance；CSP 禁止普通 unsafe-eval，允许 WASM，限制同源连接；不能据此断言生产交付资产与源码相同。 |

## C1：关闭 Local 登录框后，迟到回复仍打开健康记录（中危，已修复）

**攻击/触发条件：** Local 版用户提交有效密码；登录响应被本机服务负载或网络延迟拖住；用户随后按关闭或 Escape，认为退出登录流程；回复到达。无需错误密码绕过，攻击面是共享设备上的意外明文暴露。

**原始原因：** 基线 `src/components/AuthDialog.tsx:28` 的卸载 cleanup 仅取消 `loadLocalState`。`perform`/`submit` 没有生命周期代次，原 `:48` 在 `await api(...)` 后直接 `onUser(result.user)`，原 `:68` 的 Modal 允许关闭。父级 `src/App.tsx` 的 `fetchAccount(..., true)` 是一个仍有效的外部回调，可以在子组件消失后加载并显示账户。

**独立复现：** `/private/tmp/drug-local-auth-close-review-20260914.cjs` 编译并执行真实 AuthDialog 源码，使用隔离 React hooks、deferred API 和合成用户；先 submit，再 close 并执行卸载 cleanup，最后释放登录回复。修改前观察到 `lateOnUserAfterClose: 1`。这是源码回调/生命周期验证，不是完整浏览器 DOM 测试。

**修复：** 当前 `src/components/AuthDialog.tsx:17` 的 close 同步使 flow 失效；`:34` 卸载也失效；`:35` 的 perform 只向活动实例交付成功/失败状态；`:61` 在认证结果到达后检查代次。`:42` 开始父级账户加载后暂时禁用关闭，避免允许用户“取消”一个已转交父级、该组件无法撤销的数据加载。恢复完成和复制反馈也遵循代次检查。

**验证：** `tests/auth-dialog-lifecycle.test.mjs` 的 4 项回归全部通过：提交后立即关闭、仅卸载、正常登录仅打开一次、父级 handoff 期间不接受关闭。TypeScript `tsc --noEmit --incremental false` 检查通过。

**范围限制：** 此修复阻止当前页面迟到打开明文记录，不承诺撤销服务端已创建的 Local session cookie。取消 UI 与服务端注销不同；Local 版的持久浏览器会话和明文存储本就不同于云端 E2EE 模式。CloudGate 的单密码云版已有 flow/generation 保护，未发现同一缺陷。

## 独立密码学与状态机验证

临时程序 `/private/tmp/drug-client-review-20260914.mts` 使用真实安装的 OPAQUE/WASM、WebCrypto 和 CloudClient；HTTP 完全替换为内存协议 mock。最终结果在 `/private/tmp/drug-client-review-20260914-results.json`，**13 项全部通过**。最初一轮合成 fixture 缺少 profile revision，被现有并发校验正确拒绝；修正 fixture 后重跑通过，未绕过产品校验。

1. 完成独立 PAKE transcript：注册和登录 exportKey 相同；客户端与服务端 sessionKey 相同；exportKey 与 sessionKey 不同；以 sessionKey 尝试解包 exportKey 包裹的 DEK 失败。
2. 注册 finish 已提交、ACK 丢失：通过新的 OPAQUE 登录确认精确 wrapper，恢复成功。
3. 保存使用新 IV，显式 owner 不匹配被拒绝。
4. 改密码 finish 丢 ACK：新密码可确认，同一 DEK 保留，原恢复码仍可解密。
5. 恢复码轮换丢 ACK：确认新 wrapper；旧 DEK 无法解密当前快照。
6. 通过版本化恢复码恢复：只有独立 authentication token 发给 mock；更换 DEK 与恢复码。
7. envelope 的 owner、kind、version、额外字段、非法 encoding/IV/ciphertext 修改被拒绝，包括同步改 owner 元数据后仍无法绕过 AAD。
8. 显式演示旧密文回滚边界，见 B1。
9. 延迟 login/finish，期间锁定：迟到响应不能重新安装 key 或 plaintext。
10. 检查全部捕获的发出请求：没有输入密码、完整恢复码、DEK、服务端 sessionKey 或合成健康记录明文。
11. Guest 清除仅接受精确存储快照；清除撤销 consent，旧页面后续保存返回 false，不重建持久明文。
12. pagehide 后到达的 session restore 不交付用户状态。
13. Worker schema 拒绝降级 KSF 与 SharedArrayBuffer。

代码追踪补充：`opaqueLogin` 返回 `finished.exportKey`，调用者只用它导出 HKDF 包裹 key；网络发送的是 finishLoginRequest，不发送 exportKey 或 sessionKey。HKDF 使用 SHA-256、随机 16 字节 salt，以及协议/版本/用途/cipher/owner/context 的 info；data 和 wrapped-key 使用不同 AAD tuple。AES-GCM 为随机 12 字节 IV、256 位 key、128 位 tag。纯结构验证与成功 AEAD 解密是分离的；解密数据再经过应用领域 schema。

## 明确安全边界与后续建议

这些不是伪装成新漏洞的已有威胁模型限制。

**B1：恶意服务器可回滚有效密文，完整性不等于新鲜度。** `vault-crypto.ts` 的 data AAD 不绑定服务端 snapshot revision，`cloud-client.ts:150` 只拒绝数值更低的 revision。合成测试将当前 revision 与同 key 的旧有效密文组合，`/data` 接受并显示旧记录。服务器无需获得 DEK 即可实施；重新加载后内存 revision 高水位也不存在。`public/privacy.html:58` 已准确披露。若以后要求可检测这种回滚，需设计经过认证的客户端序列/链和可信持久检查点或外部透明日志；仅给 ciphertext 增加 revision 字段不能解决全量状态回滚。

**B2：同源代码交付、XSS 与供应链属于解密信任边界。** Dedicated Worker 提供隔离执行和生命周期，不抵御已经控制本页脚本的攻击者；同源脚本能读取表单、调用应用、取得明文/可导出 DEK。CSP、固定依赖和 provenance 降低风险，但不能让恶意站点变成可信客户端。`CloudGate.tsx` 与隐私页已有披露。若威胁模型包含恶意运营者，需要独立可信分发或由外部验证的客户端；同一服务器自报 hash 不足以建立信任。

**B3：清除不是跨进程或法证擦除。** Guest 清除删除当前页面与匹配的持久存储副本，其他打开标签内存可能仍持有原值；storage listener 关闭的是自动保存，不是远程擦除每个标签。JS 字符串、浏览器 GC、密码管理器、剪贴板、下载、系统 swap/备份均不在可保证擦除范围。恢复码为明文主动下载，UI 有提示；CSV/JSON 亦为主动的明文导出。

**B4：会话撤销不能即时清除离线已解锁端。** CloudGate 在 open 阶段每 60 秒/focus 复核 session，失败时继续保留现有内存，空闲锁定 10 分钟。保持活动的离线标签可继续显示已有数据，直到手动锁定/关闭/恢复在线；服务器只能阻止之后的服务端访问。Security UI 已说明其他页面在下次检查或空闲时锁定。网络请求没有应用层总时限，悬挂请求也可能延长 async 函数中敏感字符串的生命周期；可考虑有界请求/响应读取与重新加载指引，但不应为恢复活性而破坏 cookie 改写顺序。

**B5：历史 key 与 ciphertext 无法撤回。** 改密码只重新包裹当前 DEK，原恢复码按设计继续生效；轮换/恢复会换 DEK，但旧 key 可以解密以前复制的旧 ciphertext。OPAQUE 对服务器认证数据库加 setup secret 的失窃也不提供“不能离线猜密码”的保证。

## 未覆盖与置信限度

- 未独立证明 OPAQUE/Argon2/WASM 依赖的常数时间性质、内存清理、实现证明、二进制与上游 Rust 源码对应；本轮验证其接口使用及真实协议运算，非第三方密码库完整审计。
- 未执行真实 Safari/Firefox/Chrome 的 Worker、BFCache、password-manager autofill、多个标签/多个 browser profile 的端到端 UI矩阵；对应生命周期依靠源码审查和合成事件/回调验证。
- 未验证生产 TLS、托管平台权限、数据库权限/事务、服务端 rate limit、secret 持久化、网络日志或实际部署 provenance；交由服务端/运维角色。
- 未把依赖版本固定或 CI 成功当作不存在新 CVE 的证据；在线 advisory 核查需由供应链审查汇总。
- 未进行医学模型有效性、错误剂量判断或所有 UI 大数据性能的完整审查。
- 本轮发现修复应由第二轮新审查员重新验证，避免将修复者自测当作独立复审。

## 使用的第一方协议参考

- [RFC 9807：OPAQUE，尤其 §10.4 Export Key Usage 与 §10.8 OPRF Key Stretching](https://www.rfc-editor.org/rfc/rfc9807.html)：用于核对 client-only export key 与 shared session key 的角色、成本参数及服务器失窃边界；不据此声称已验证整个库符合 RFC。
- [RFC 5869：HKDF](https://www.rfc-editor.org/rfc/rfc5869.html)：用于核对 salt 与 info 用途分离设计。
- 同时读取本地 `@serenity-kit/opaque` 包的实际 `index.d.ts` 与安装版本，核验代码调用 API。外部 `opaque-auth.com/docs/api` 未能读取，未将该页面作为证据。
