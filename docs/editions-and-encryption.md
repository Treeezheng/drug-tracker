# Drug Tracker：本机版、云版与加密边界

更新：**2026 年 9 月 13 日**。本文按当前代码区分版本，不是独立安全认证。本机版保持原有存储；新的云端加密、认证和浏览器入口已写入独立模块，正在完成整体联调。**没有部署真实云服务器，也没有完成真实域名 HTTPS 与 iPhone 云端全流程验收。** 模块测试通过不能替代这些验证。

## 实际版本区别

| 能力 | 本机版 | 当前云版代码 |
|---|---|---|
| 页面 | Dose Simulation、History、Settings | 默认访客演算；注册并解锁后使用三个账户页面 |
| 入口 | 默认构建；server/index.mjs；loopback 4310 | 显式 cloud 构建；server/cloud.mjs；loopback 4312 |
| 登录 | 初次设密码；单账户随后只输密码 | 公开注册用户名 / 账户密码，服务端 scrypt；每账户独立 owner |
| 解密 | 无客户端健康数据库加密 | 服务器登录后，浏览器另用加密密语或客户端恢复密钥解锁 |
| 服务器健康记录 | SQLite 中为明文 | 每账户一个完整 AppData 密文快照和包装后的数据密钥 |
| 浏览器缓存 / 队列 | IndexedDB 明文缓存与离线队列 | 解锁账户记录/密钥仅内存；访客演算另存明文 localStorage |
| 保存 | 可暂存设备，随后同步本机服务 | 在线 CAS 保存；失败不回退到本机明文队列 |
| 纠正与删除历史 | 服务端保留版本 / 删除信息，完整备份可包含 | 当前只保存现存记录，未实现云端修订历史 / 删除历史 |
| 用户下载 | 明文 CSV、PDF、完整 JSON 备份 | 明文 CSV、PDF、现存记录 JSON 备份，界面明确披露 |
| 恢复 | 本机恢复码重置登录密码 | 客户端恢复密钥解开健康数据；不重置服务器登录 |
| 公网 | 本机入口不可直接发布 | 部署模板已准备；账户、VM、HTTPS 和恢复演练仍待完成 |

本机密码控制网页访问，不会把 SQLite 变成加密数据库。拥有 Mac 文件访问权限的人仍可能读取数据库或浏览器存储。HTTPS 保护传输，服务器磁盘加密保护部分磁盘泄露情形；它们都不能单独称为端到端加密。

## 云端已经实现的边界

- `server/cloud.mjs` 要求单独绝对数据库路径、精确 HTTPS origin 和带 cloud 标记的静态构建；拒绝已含本机表的数据库。启动只绑定 127.0.0.1。不改造或复用本机健康数据库。
- 云 API 位于 /drug/api，公开注册创建独立账户；每账户一个独立 owner ID 与密文 vault。可选 CLI bootstrap 只允许空库初始化第一个账户，不是创建所有账户的必经步骤。没有 HTTP bootstrap、本机明文记录 API 或云账户密码重置 / 恢复入口。注册不要求邮箱，也不提供身份或邮箱核验。
- 认证使用带盐 scrypt；会话 token 在服务端存散列。生产 cookie 为 `__Secure-drug_cloud_session`，包含 Secure、HttpOnly、SameSite=Strict 和 Path=/drug/。cookie Path 不能作为同源代码的安全隔离。
- 服务端严格匹配 Host；所有写请求都要求与配置相同的 Origin，拒绝跨站 Fetch Metadata；不以不可信转发头决定允许来源。读取 vault 也要求会话和匹配的 owner header。登录与注册各有服务级全局限流，共享密码散列并发上限，不靠伪造的来源 IP 分配额度；具体参数见云 API 文档。
- `server/vault-store.mjs` 仅检查权限调用方传入的 owner、信封结构、长度和版本，以事务把数据 / 包装密钥成对保存。whole-vault revision CAS 防止正常并发写覆盖。服务端不能验证药名或数量的真实性，解密后的内容校验在客户端。
- `src/lib/cloud-client.ts` 对调用者输入先限量复制、做应用 schema 校验，再加密上传；密钥及解密记录留在 closure 中。串行保存、明确冲突与相同密文的重试确认，避免把健康明文写进本机离线队列。关闭或锁定页面会放弃未确认的内存编辑，用户需要留在页面处理保存失败。
- `src/components/CloudGate.tsx` 分开服务器登录、首次加密密语设置、解锁和恢复密钥展示；云构建由 src/main.tsx 显式选择。页面卸载 / 恢复时重新锁定，异步操作以 generation 检查防止恢复已丢弃的明文状态。完整 UI 和生命周期仍需真实浏览器验证。

## 访客演算不属于加密账户记录

访客使用独立演算界面与 versioned localStorage key，保存模拟 dose、常用药和演算设置；包含用户填写的备注，存储为明文。浏览器重新加载后可以恢复，使用同一浏览器 profile 的其他人或同源脚本可能读取。Clear simulation 清除当前浏览器中的访客工作区，不保证删除设备备份中的旧副本。

访客只做模拟，不发健康数据 API 请求，也不能把演算直接写成 Taken、症状或库存历史。需要账户功能时进入登录 / 注册；创建新的加密 vault 不传入访客数据。正式账户退出 / 锁定先卸载账户数据，访客工作区可以另行保留。账户数据仅内存的保证不能扩大为“整个网站从不使用 localStorage”，也不能把“不上传访客数据”表述为“访客数据已端到端加密”。

正式地址为 **https://treeezh.com/drug**。API / 构建资源前缀为 /drug/，浏览器 Origin 是 https://treeezh.com，不含路径。/drug 不能隔离同源其他页面的 IndexedDB、脚本或更广作用域的 Service Worker；整个域名的代码都需可信。[同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)、[Cookie 属性与前缀](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

来源校验应由固定 public origin 决定，不能为了反向代理而通配 Origin 或接受任意转发 Host。当前方案使用严格 Origin 与 Fetch Metadata 作为 cookie 写请求防护，需在真实 Caddy 路径下重复验证。[OWASP CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

## 密钥与协议

`src/lib/vault-crypto.ts` 使用浏览器 Web Crypto，不自行编写密码算法。当前是**每个 owner 一个完整 AppData blob**，不是每剂量独立加密协议。[Web Crypto encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)

1. 随机生成 256 位 AES 数据密钥；每次加密用新随机 12 字节 IV、AES-GCM 和 128 位 tag。AAD 绑定 protocol、version、kind、cipher 和调用方提供的可信 owner；包装密钥额外绑定全部 KDF 参数。
2. 独立客户端加密密语通过 PBKDF2-HMAC-SHA256 派生 KEK，600,000 次、随机 16 字节 salt，包装随机数据密钥。读取范围为 600,000–2,000,000 次，拒绝过低或过高参数。需要在 iPhone Safari 实测延迟；未来换算法需要版本迁移。OWASP 的工作量数字不是项目通过安全审计的证明。[OWASP 密码 KDF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
3. **账户密码会发送给服务器；加密密语不得与它相同。** 不复用服务端认证密码为 vault secret。服务端没有 KEK / 数据密钥环境变量；浏览器错误路径也不应上传密语。[密钥分离与包装](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
4. 当前客户端恢复材料是完整 32 字节数据密钥的 43 字符 base64url 表示。这就是可以解密数据的完整密钥，不是普通验证码。用户私下保存，服务器不生成或接收它。恢复密钥能解锁现有数据，但当前界面还没有更换加密密语或旋转数据密钥的流程。
5. 信封采用严格字段、规范 base64url、长度 / KDF 上限；明文 JSON 在大规模字符串化前有累计 16 MB 字节限制、深度与节点限制。错误密码、owner、AAD 或密文统一拒绝，解密后继续做医疗记录的结构校验。

网络重试可以重发完全相同的密文信封，不能用同一个 nonce 加密变化后的明文。未来多个 vault / 每条记录方案必须新版本绑定 vault / record ID，不能直接扩大当前一个 blob 的协议含义。

当前云 vault 覆盖现存的 Profile、Dose、Scenario、Favorite、Checkin、Inventory，包括单位、时区和药品快照字段。**不包含已删除实体或每次纠正的旧版本**；导入带有这些历史的本机完整备份会明确拒绝，避免静默丢弃历史。用户应保留原始本机备份，另行选择现存记录快照迁移。以下功能尚未实现：默认加密的完整备份、持久离线密文缓存、修订历史和密钥轮换，不能在产品文案中声称已有。

## 服务器仍可看到什么

服务器可看到账户用户名 / 名称、登录散列、会话、owner ID、同步时间、密文总长度和 vault revision；网络基础设施还可能看到 IP 与访问时间。药名、服药时间、数量、睡眠和症状位于密文内。单个完整 blob 不把每条药物记录 ID / 数量单独暴露给同步服务，但密文长度与修改节奏仍有信息泄露，不能宣称匿名。

AES-GCM 发现密文篡改，**不能单独发现服务器回滚整份旧的合法密文与包装密钥**。CAS 处理普通并发冲突，不是恶意回滚防护。当前没有独立设备检查点或透明日志，也不承诺新设备可以自行判断服务器给出的是否为最新版本。

## 保护范围与尚需验证的工作

在客户端和分发代码可信、加密密语足够强的前提下，服务器数据库 / 备份的只读泄露不应直接暴露健康内容；攻击者仍可离线猜测弱密语。服务器登录重置不能提供解密能力。丢失全部加密密语 / 客户端恢复密钥时，服务器不能恢复内容。

E2EE 不防已解锁设备的恶意扩展、操作系统入侵、截图、剪贴板读取或用户导出的明文泄露。锁定丢弃引用，但 JavaScript 不保证运行时物理内存清零。**被攻破的服务器如果能替换下次加载的 JavaScript，可能在解锁时窃取密钥。** 开源、HTTPS 与 self CSP 都不自动解决代码分发信任；当前没有独立可验证的客户端分发 / 更新机制。[W3C Web Crypto 安全考虑](https://w3c.github.io/webcrypto/#security-considerations)

恢复密钥泄露后，仅改账户密码或重新包装数据密钥不能撤销旧密钥；需要新数据密钥、重新加密和旧备份处理，现阶段未实现这个操作流程。备份的云 SQLite 还包含登录散列及会话元数据，应私密保存，并保留原 owner ID。下载的 CSV / PDF / JSON 是明确由用户生成的明文，需要与加密服务器备份区分。

上线前需完成：真实 Caddy 的来源 / cookie / 路径验证；Mac 和 iPhone Safari 解锁、恢复与锁定；断网和同页重试；两个设备并发；数据库 / WAL / 网络 / 浏览器存储的合成明文检查；单独路径中的备份恢复演练。正式 Mac 数据不用于失败测试，也不自动迁移或删除。

部署文件与操作步骤见 [Azure VM 指南](./azure-vm-deployment.md)，申请见 [学生计划](./cloud-and-student-plan.md)。Azure 注册仍等待用户；没有启用 CI，没有部署或改 DNS。idea、需求及设计选择来自 Abraham Zheng；应用代码由 AI（Codex / OpenAI）实现，属于个人实验，不宣称临床验证或独立安全审计。
