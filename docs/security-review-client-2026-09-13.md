# 浏览器端安全复核 · 2026-09-13

## 当日晚些时候：单密码 OPAQUE 版本

用户随后选择单密码与完整恢复码，当前源码已改为固定 `@serenity-kit/opaque` 1.1.0；主密码只在浏览器运行 PAKE，客户端 export key 经 HKDF 包装随机 DEK（v3）。生产关闭原始密码与旧迁移路线。完整恢复码包含独立的账户恢复 token 与 DEK，仅 token 半段可提交服务器；重设密码、轮换及恢复通过新鲜认证/受限授权和原子 CAS 完成。主密码策略为客户端15–256 Unicode codepoints、score4；服务器不接收主密码，不能验证其评分。

下面“Claude报告后”的Argon2双密码批次及其67项、原始79项均继续保留为**历史阶段**，不是当前登录方式。现行精确设计、失败处理和验证范围见 [单密码协议](./vault-crypto-design.md) 与 [当前客户端](./cloud-client-design.md)。运营者能替换所供JS/被控制设备的边界、旧密文不能撤回、新客户端缺乏独立新鲜性锚点及C-05无请求deadline的可用性限制仍然存在。

## 当日较早的后续复核：Argon2双密码历史快照

**2026-09-13，Claude 报告后的修复批次。** 以下更新描述此时工作区源码，不能由此断言该版本已经部署到所有线上实例。后面的原始79项测试、PBKDF2表格和行号保留为早期审查历史，不能继续当作当前功能缺失或最终安全保证。此轮仍由参与实现的代理交叉复核，不是第三方独立审计。

- **新 KDF 与兼容性：** `src/lib/vault-crypto.ts:231,278`、`vault-kdf.worker.ts` 新写入 key envelope v2，使用既有 hash-wasm Argon2id v19、64MiB/3 passes/1 lane、16-byte salt，Worker 完成/锁定时终止。data envelope 仍v1；旧PBKDF2 key envelope v1保持兼容读取，不因新强度策略拒绝合法旧弱密码。参数固定且严格校验，CSP仅新增 wasm-unsafe-eval，未增加 JavaScript unsafe-eval。详见 [协议说明](./vault-crypto-design.md)。
- **强密码与密钥更换：** 共享 `password-policy.mjs` 本地 zxcvbn 字典检查及顶级常见密码装饰变体拒绝；新账户最少15字符、score>=3，新加密密码最少12字符、score4。当前账户密码经真实API重新验证，当前加密密码/恢复密钥在本地解密重认证。`cloud-client.ts:285` 更换加密密码只重包同一DEK/恢复密钥；Replace recovery key生成新随机DEK、全库重加密、新恢复密钥。两者在一次CAS原子替换成对envelope，具有丢确认对账/同一密钥重试和锁定generation保护。旧密钥不能读轮换后的新数据，但旧副本/备份不可撤回，运营者可篡改所供JS的边界仍然存在。
- **C-04 已缓解：** `CloudGate.tsx:43–53` 接入10分钟活动闲置锁，focus/visibility补检，以及已开账户约每60秒和focus时检查session；24小时服务器session及全部设备退出已实现。服务器撤session后，正常在线页面下一次检查会卸载账户数据。它不是跨设备即时擦除：浏览器被冻结、网络离线、请求挂起时检查可能延迟；已下载或此前已复制明文不受远端控制。
- **访客默认与同意：** GuestSimulator 默认只在内存演算，首次开始需18岁声明；明文设备存储需要单独选择 Remember。没有相应同意时不自动打开旧localStorage草稿。`guest-consent.ts:23` 每次写前重新检查同意，GuestSimulator监听storage事件撤销自动保存，防止另一标签页清除同意后旧页的后续保存重新写回。该保护不是跨标签页原子存储事务，也不能远程擦除别页已载入的内存。绿色Add的新交互仅本地校验并折叠模拟行，status仍为simulated，不写API或正式账户；标题旁的登录链接用于引导保存正式记录。访客资料与账户加密数据保持分开，不自动上传。
- **C-05 仍是已知可用性限制：** 本轮没有给未结束的HTTP响应强行释放认证队列，也没有声称所有审查项完全消失。具体评估见下面C-05补充；Lock/Browse能清本地状态，但挂起的同实例网络队列可能需要重新载入页面。

**新验证，独立于历史79项：** 本轮 `vault-crypto.test.ts`、`cloud-client.test.ts`、`cloud-registration-client.test.ts`、`password-policy.test.ts` 共 **66/66** 通过；另 `cloud-security-chain.test.mjs` **1/1** 通过，共 **67项，0失败/跳过**。真实组合测试用createCloudClient、实际cloud API、临时SQLite和HTTP cookie jar，覆盖双重认证、rewrap、两设备CAS、轮换后旧key不能读当前/未来数据、服务端真实提交后丢ACK及首次对账、原密钥重试、账户改密撤旧session、logout-all撤销两个session；请求与临时DB/WAL未发现合成加密密码、恢复密钥或健康profile明文。另用Node原生Argon2验证hash-wasm包装互操作，原生PBKDF2旧弱密码fixture验证兼容。TypeScript与diff检查通过。临时库已清理，未访问真实账号或Heroku；此组合不等于PostgreSQL客户端全链、真实浏览器TLS或第三方渗透测试。

## 原始审查快照（历史记录）

范围：当前工作区（起始提交 `3aa3868` 及本轮未提交变更）的 CloudGate、cloud-client、vault-crypto、api、GuestSimulator、guest-workspace、App 导入/导出，以及服务器对浏览器发送的安全响应头。直接阅读源码，并仅用合成数据运行测试；没有读取真实账户、浏览器存储、密码、恢复密钥或线上数据库，没有操作真实浏览器会话。

这是开发过程中的代码交叉复核，不是独立第三方审计、渗透测试或安全认证。复核代理也参与过部分实现。文件行号对应本轮审查时版本，后续并行修改可能移动行号。

## 结论

在检查的正常账户流程中，正式记录在浏览器加密后才上传；没有发现加密密码、原始恢复密钥或记录明文被发往 API 的路径。没有发现云版将解密后的正式记录写入 IndexedDB、localStorage 或离线队列的路径。未发现可直接证明的 P0/P1 明文泄露漏洞；这不等同于证明不存在漏洞。

“账户记录在浏览器端加密，当前服务器不持有可直接解密记录的密钥”符合所审代码。“运营者无论任何情况都无法解密”不符合此 Web 架构的保证范围：运营者或供应链攻击者可能更改之后送到浏览器的 JavaScript，捕获输入的秘密或已解锁记录。弱加密密码也可能被离线猜测。

## 已发现并修复

### C-01 · P2：大备份在上限检查前被完整读取

**原证据：** `src/App.tsx` 的 Backup & restore 文件处理原先先执行 `await file.text()`，随后才调用 `parseBackup()`。`src/lib/reports.ts` 的 16 MB 校验只限制已分配的字符串，不能阻止读取一个非常大的文件。用户导入不可信或误选的巨大 JSON，可能耗尽当前标签页内存并丢失未保存内容。

**修复：** `src/lib/reports.ts:477` 的 `readBackupFile()` 先检查 `File.size <= 16,000,000`，再读取；`parseBackup()` 仍检查实际解码文本的 UTF-8 字节数、深度、字段、ID 和记录结构。`src/App.tsx` 的文件处理使用该 helper。

**验证：** `tests/reports.test.ts` 用超过上限的虚拟文件确认 `.text()` 从未调用；合法备份往返；低报大小但实际 UTF-8 超限的内容仍被拒绝。不需要建立真实大文件。

### C-02 · P2：开始生成的 PDF 在锁定后仍可继续下载

**原证据：** `src/lib/reports.ts` 在 `await import('jspdf')` 后无取消检查，继续使用已捕获的记录生成文件；`downloadPdf()` 直接调用 `pdf.save()`。`src/App.tsx` 的 History 处理没有卸载或账户变化取消。可复现路径为：首次点击 Medication PDF，在模块加载期间 Lock/Sign out，稍后仍触发明文下载。此次复核以源码时序确认，未操作真实浏览器重现。

**修复：** `src/App.tsx:177` 起按 History 实例、账户 owner、导出 generation 管理 AbortController，卸载或切换账户取消；`src/lib/reports.ts:173` 起让模块等待可立即取消，取消后结束等待中的导出调用；`:327` 在最终触发下载前再次检查。已经交给浏览器的下载不能通过 Lock 撤回，已下载文件仍是明文。

**验证：** `tests/reports.test.ts` 的延迟 PDF 测试确认取消先完成，迟到结果不调用保存；实际 PDF 构建在立即取消后拒绝；正常未取消路径仍保存。取消清除应用的活动引用，不承诺 JavaScript 垃圾回收器或操作系统立刻物理擦除内存。

### C-03 · P2：已观察到的 vault revision 可倒退

**原证据：** `src/lib/cloud-client.ts:128` 的远端读取原先仅验证 revision 为正整数，没有与当前快照比较。合成服务器保存 revision 1，客户端写入 revision 2，服务器随后返回原 revision 1 的完整合法密文；实际运行确认 `/data` 接受旧内容并把客户端版本从 2 降到 1。这样可能重新显示已删除记录。

**修复：** `readRemote()` 拒绝同 owner 下低于当前已知 snapshot 的 revision，返回 409，保留打开的数据与版本。当前实例 Lock 后再次解锁也保留这个版本下限。

**验证：** `tests/cloud-client.test.ts` 新测试先删除记录，再回放旧密文，确认刷新拒绝、当前导出仍无已删除记录、版本不倒退；重新解锁也拒绝旧版本，而最新版本仍可解锁。

**残留边界：** revision 不是密文 AAD 中经过认证的字段。恶意服务器可以给旧密文标一个未被观察到的更高版本；全新浏览器/刷新后的实例也没有可信版本下限。此修复防止已知版本倒退，不构成完整防回放协议。若将来要求检测恶意服务器回放，需要独立可信的版本/摘要保存或透明日志设计，并评估丢设备和恢复的行为。

## 原始限制与建议（当前状态见当日后续复核）

### C-04 · 原P2，现已缓解但保留离线/远端擦除边界：其他标签页退出

**原版本证据：** `src/components/CloudGate.tsx:33–40` 处理 pagehide 和 bfcache 恢复，`:59–64` 在收到 401 或发现 session owner 改变时关闭账户视图；当时没有 BroadcastChannel 退出通知、focus 检查或定期 session 检查。`src/App.tsx` 自动刷新只监听 online。`src/lib/cloud-client.ts` 的 `/export` 只读取当前内存，不向服务器请求。当前已增加idle/focus/60秒检查，见顶部跟进，不能继续描述为完全未修复。

合成复现：客户端已解锁后令模拟服务器会话失效，不发送其他请求，随后 `/export` 仍能返回此前解密的内容，而且没有新网络调用。显式 `client.lock()` 后同一操作被拒绝。真实双标签页表现未由本次审查操作验证。

建议：明确 Lock 作用于当前页面；可增加不携带秘密的同源锁定/退出广播和重新聚焦时的会话检查。广播应只降低权限，不能传密钥或解锁另一个页面。服务器撤销会话不能远程擦除已经发送到浏览器的明文。新增自动锁定策略需要平衡未保存记录，不应默默宣称跨设备即时擦除。

### C-05 · P3：挂起的响应没有客户端截止时间

`src/lib/cloud-client.ts:60–77,117–126` 对响应字节数有限制，但没有请求/读流截止时间。模拟永不结束的认证响应可让 `authQueue` 长期等待；Browse 能清理当前账户，但下一次认证要等待旧请求完成。不能简单释放认证队列，否则旧响应的 Set-Cookie 会覆盖新会话。

建议后续加入严格的网络超时和可取消读取，保留认证请求按完整响应顺序执行的保证，并测试迟到 cookie、退出后马上登录及取消尚未发送的注册。当前不是已证实的数据外传路径。

**当日复评：仍未实施客户端请求截止时间。** 当前 `cloud-client.ts:67` 的responseJson限制读取字节数，`:127` 的wire仍没有超时AbortSignal。仅给fetch或读流加timeout，然后允许后续认证发出，不能单凭Promise拒绝证明浏览器已完成先前响应的cookie处理；可能破坏已验证的认证请求排序。更稳妥的方案需将不确定认证转为“清钥且本实例不得再认证、必须整页重载”，同时区分普通密文保存的可对账超时，并验证真实浏览器的迟到Set-Cookie、未发送注册取消和page lifecycle。它涉及认证状态机及提示，不作为本次仓促的小修。现有Lock/Browse可同步清key和卸载UI，但无法结束挂起的请求/队列，重新载入为可用性恢复途径；这是明确残留限制，不是“全部问题已修复”。

## 密钥、网络与存储路径核对

| 项目 | 实际源码依据与结果 |
| --- | --- |
| 数据加密 | `src/lib/vault-crypto.ts:178,199–207`：WebCrypto 随机 AES-256-GCM key，每次加密随机 12-byte IV，128-bit tag。密钥为支持包裹和恢复导出而可导出。未发现自制随机数。 |
| 密钥包裹 | 同文件 `:222–249`：独立加密密码、本地 PBKDF2-SHA256、随机 16-byte salt、默认 600,000 次；读取限制 600,000–2,000,000，包裹也使用 AES-GCM 与独立随机 IV。密码字符串不被归一化。 |
| AAD 与解析 | 同文件 `:70–94`：固定 protocol/version/kind/cipher/受信 owner；wrapped-key 还认证 KDF 元数据。严格字段、canonical base64url、尺寸上限、错误统一。owner 由当前登录用户提供，不由不可信 envelope 自称。 |
| 密码发送 | `src/lib/cloud-client.ts:143–158`：只有账号密码随登录/注册请求发往同源服务器；`:170–220` 的加密密码、恢复密钥只进入本地 WebCrypto。vault PUT 为 envelope + wrapped key + expectedRevision。 |
| 两密码区别 | `src/components/CloudGate.tsx:25–31,89–100`：新注册/登录后在内存比较；已有 cookie、尚未建 vault 的恢复流程需要重新输入账号密码。此 UI 校验不是把加密密码发往服务器比较。 |
| 内存与 Lock | client `:134` 清 key/data/pending/pendingSetup，generation 阻止迟到保存重新设置数据；Gate 切离 App 并清输入/恢复 key。异步加密、字符串、浏览器进程副本不能保证立刻物理擦除。 |
| 正式数据缓存 | `src/main.tsx:17–19` 在首次渲染前设置云 transport；`src/lib/api.ts:134–142,179–220` 的云模式提前返回/拒绝，绕过 IndexedDB 缓存和明文 outbox。Local 版仍是明文数据库与 IDB，不能套用云版 E2EE 描述。 |
| 游客数据 | `src/lib/guest-workspace.ts:5–9,52–75`：500 KB 上限，专用 localStorage key，白名单只允许模拟草稿/收藏/模拟设置；状态强制 simulated。GuestSimulator 的 Taken 调用登录入口，无正式保存。Gate setup 没有传入 guest initialData。 |
| 下载 | CSV/PDF/JSON 明文，用户主动导出；CSV 文本首字符公式防护见 `src/lib/reports.ts:89–94`，文件名来自日期/固定字符串。未发现将备份发送到第三方或上传明文至 cloud API 的路径。 |
| 第三方网络 | 源码全局搜索未发现 analytics、sendBeacon、WebSocket、远程字体或 service worker。`main.tsx` 字体是打包的 @fontsource 文件。外部来源/GitHub 链接用户点击后联系对应站点，使用 noreferrer。动态 PDF 模块来自同源构建产物。 |
| XSS 与 CSP | 搜索未发现应用使用 dangerouslySetInnerHTML、innerHTML、eval 或 new Function 接收用户内容。React 文本插值输出记录与服务端错误。`server/cloud.mjs:159–167` 设置 no-store、nosniff、DENY、COOP/CORP same-origin、script-src/connect-src self、禁止 object/base/frame ancestor；style unsafe-inline 为内联样式保留。CSP 不是防止所有 XSS 的证明。 |

`/drug` 与 `treeezh.com` 的其他路径共享 origin。根站脚本、已有/未来根作用域 service worker、同源托管内容和第三方脚本依赖都必须可信；Cookie Path 和 URL 子目录不构成浏览器安全隔离。若根站将来承载不可信脚本，应重新评估是否移到专用子域名。

## 对外表述

建议写：“正式账户记录在浏览器中加密后上传。服务端保存密文和包裹后的密钥，不接收加密密码或恢复密钥；账号、会话、连接时间及密文大小等元数据不属于端到端加密内容。此 Web 版依赖浏览器收到的应用代码可信，不能抵御被篡改的前端、恶意扩展或已失陷设备。”

审查开始时 `public/privacy.html:20,26` 仍写“尚未部署”，`:24` 写尚无自助删除。根代理正在更新正式政策与删除流程，必须以最后实现和线上实际配置为准，不能把本报告当上线/删除验证。注册页原有账户记录 E2EE 描述范围正确；“无密码或恢复 key 则无法恢复”宜表述为“不提供运营者恢复”，并保留弱密码与恶意前端边界。

## 验证记录与未覆盖范围

修复后三项源代码变更及下述账户删除回归：Node 24，以下六个现有测试文件 **79 / 79 通过，0 失败，0 跳过**：`vault-crypto.test.ts`、`cloud-client.test.ts`、`cloud-registration-client.test.ts`、`guest-workspace.test.ts`、`reports.test.ts`、`symptom-reports.test.ts`。TypeScript 类型检查及 `git diff --check` 通过。另有本地合成脚本实证 C-03 原行为与 C-04 闲置会话边界；未访问真实数据。

本轮追加实现了云端自助删除客户端：`src/lib/cloud-client.ts:239` 的 `deleteAccount()` 先排入记录操作队列，再通过认证队列发送 `DELETE /drug/api/account`，请求仅含账号密码与当前 owner header，不发送加密密码或恢复密钥。成功确认 `{ok:true}` 后清除 key、data、pending、user 和 snapshot；之后排队的旧操作因 generation 改变被拒绝。根代理在 `CloudGate.tsx:62` 接入成功卸载 App。403 错误密码保留当前数据；401 走现有锁定路径；没有确认响应时不声称已经删除。

新增合成测试覆盖：成功清理且仅发送账号密码、错误密码保留、额外字段/错误 owner 不发请求、等待已开始的保存、删除后旧写入不恢复数据，以及迟到的删除清 cookie 响应必须在新账号登录之前结束。游客 localStorage 和既有下载不随账户删除清除。其他标签页仍具有 C-04 的边界；本轮不证明服务端或供应商备份已擦除。线上完整删除 UI 与服务器事务结果由根代理/服务端报告分别验证。

未覆盖：线上最终 bundle 与所审源码一致性、生产 CSP/HTTPS/CDN/代理配置、真实跨标签页和下载 UI、浏览器/OS 内存及磁盘取证、扩展、所有依赖漏洞与供应链审计、渗透测试、密码强度统计、服务器日志/备份/管理员权限、删除后的供应商备份保留政策、恶意服务端完整防回放。服务端另有独立报告。此文档不构成隐私合同、安全认证或临床有效性声明。
