# Drug Tracker：本机版、云版与加密边界

更新：**2026 年 9 月 13 日**。本文区分当前主应用与下一阶段设计；不是安全认证。现有日常登录、数据库和同步仍是本机明文架构。`src/lib/vault-crypto.ts` 与 `server/vault-store.mjs` 的独立基础模块已开始实现，**仅有模块或单元测试不等于主应用已实现 E2EE**。

## 已实现与未实现

| 能力 | 当前本机版 | 自托管云版目标 |
|---|---|---|
| 日常界面 | Dose Simulation、History、Settings | 保留同样的三个页面 |
| 解锁 | 初次设密码；单账户随后只输密码 | 服务器认证与客户端数据解锁分离 |
| 密码保护 | 服务端带盐 scrypt；会话 token 存散列 | HTTPS 认证、Secure cookie、受控账户初始化 |
| 数据存储 | Mac 上 SQLite；IndexedDB 缓存与队列 | 服务器只保存客户端产生的密文 |
| 修改历史 / 备份 | 有版本、删除标记和完整备份；内容仍有明文 | 所有版本内容和备份数据同样加密 |
| 恢复码 | 服务器生成，可重置本机登录密码 | 独立客户端恢复密钥，可解开数据密钥 |
| E2EE 集成 | **未完成** | 密钥、同步、缓存、恢复全部验证后启用 |
| 公网部署 | **未实施，默认仅允许本机** | 自有 VPS + HTTPS + 密文同步 |

本机密码控制网页访问，不会把 SQLite 变成加密数据库。拥有 Mac 文件访问权限的人仍可能读取数据库或浏览器存储。HTTPS 保护传输，服务器磁盘加密保护部分磁盘泄露情形；它们都不能单独称为端到端加密。

## 当前代码的实际边界

以下定位按函数 / 路径描述，行号可能随修改变化。

| 位置 | 已检查行为 | 云版必须改变的部分 |
|---|---|---|
| `server/index.mjs` 的 `cookie()` | HttpOnly、SameSite=Strict、Path=/，无 Secure | 公网会话加 Secure；`Path=/drug/` 可用 `__Secure-` 前缀；`__Host-` 则必须 Path=/，不可混用；保留本机兼容分支 |
| 请求入口 `hosts` / `origin` | 只接受 localhost / 127.0.0.1 的 HTTP 来源，拒绝 cross-site | 配置唯一 HTTPS public origin，严格匹配 scheme / host / port；不通配或跳过 |
| `server.listen()` | 绑定 `127.0.0.1` | 同机 Caddy 可保留；Docker bridge 端口映射接不到容器自身 loopback |
| `rateLimit()` | 内存 Map，按 socket.remoteAddress 限账户尝试 | 代理会聚合来源；只信任配置的代理头，测试伪造头、重启和并发 |
| `/api/auth/local-setup`、`/api/auth/register` | 本机允许初始化 / 注册 | 云版关闭公开注册，受控一次性 bootstrap 创建个人账户 |
| setup / unlock / recover | 服务器接收密码、生成恢复码并存其散列 | 不兼任 vault secret；重置登录不应自动获得解密能力 |
| `entities.payload` / `entity_revisions.payload` | 服务端校验、保存明文健康 JSON | 独立密文 envelope schema，服务器不解析药名、数量和笔记 |
| `src/lib/api.ts` | IndexedDB cache / queue 保存 AppData / 请求 body | 持久缓存、待发送队列也加密，锁定后不能留下可直接读取的记录 |
| 完整备份 / 恢复 API | 服务端导出、解析、恢复明文历史 | 加密备份；浏览器内校验、恢复；不发送明文 restore body |
| 静态响应 CSP | 已有 self 来源 CSP、object-src none、frame-ancestors none 等 | 保留并验证实际构建；CSP 不是 E2EE，也不防可信源码本身被替换 |

云模式建议有显式 `local` / `cloud` 分支：**省略配置仍为 local**；cloud 缺少正确 HTTPS origin、受控初始化方式或加密 schema 时拒绝启动。此开关是待集成设计，当前不能设置一个环境变量就开启 E2EE。

正式地址为 **https://treeezh.com/drug**。API / 构建资源的路径前缀为 `/drug/`，浏览器 Origin 则是 `https://treeezh.com`，不含路径。`/drug` 不能隔离同源其他页面的 IndexedDB 或脚本权限；整个域名的代码都需可信。Cookie Path 也不能作为同源安全隔离。[同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)、[Cookie 属性与前缀](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

cookie 认证的写请求应组合严格 Origin / Referer 校验、Fetch Metadata、CSRF token 或同等经过验证的防护，覆盖登录、恢复、删除与导入。代理后的目标 origin 最好来自固定服务端配置，不能信任任意客户端转发头。[OWASP CSRF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

## 建议的第一版 E2EE

范围先限于同一个人的 Mac / iPhone 同步，不增加医生共享、团队权限或服务器统计。图表、剂量计算、历史筛选及 PDF / CSV 仍在解锁的浏览器内完成。

1. **客户端生成数据密钥。** 当前模块为每 owner 一个完整 AppData 密文 blob，安全随机生成 256 位 vault key，使用 AES-GCM、每次新加密随机 12 字节 IV、128 位认证 tag。AAD 绑定 protocol / version / kind / cipher / expected owner，包装密钥再绑定全部 KDF 参数；调用者不能从不可信信封自行推断 expected owner。它不是逐条记录协议；未来多 vault / 每记录存储需新协议再绑定 vault / record ID。使用 Web Crypto，不自写密码算法。[Web Crypto encrypt](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
2. **客户端包装密钥。** 只在客户端使用的解锁密语派生 KEK，包装随机数据密钥。服务器只存包装后的密钥和必要参数。更换密语一般只重新包装数据密钥，不把健康数据交给服务器重加密；KEK 不能放在同一服务器的环境变量里。这是拟采用的 envelope 结构。[OWASP 密钥分离与包装](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
3. **认证与解锁分开。** 首版可以使用独立服务器登录凭据和客户端 vault 密语。不能复用当前会传给服务器的原始密码作为 vault 密语。若以后希望一个密码同时完成两件事，要单独评审成熟协议与实现，不能临时拼接散列方案。界面可以合并流程，密钥边界必须保持。
4. **独立客户端恢复。** 当前基础模块可导出完整随机 vault key 的 43 字符 base64url 表示，作为高熵恢复材料；这就是完整数据密钥，持有者可解密对应数据，不是普通登录验证码。用户私下保存，服务器不得生成或接收它。原始密钥泄露后，单纯更换登录密码 / 重新包装不能撤销旧密钥；需重新加密数据和处理旧备份。当前本机恢复码不具备解密作用；丢失全部解锁材料时服务器不能恢复内容。
5. **覆盖完整数据流。** Dose、Profile 的姓名 / 睡眠、Favorites、Supply、Symptoms、Scenario、所有修订内容及 IndexedDB cache / outbox 一并覆盖。URL、日志、分析事件不放药名或数量。只加密 note 字段不能称为 E2EE。
6. **锁定与导出。** 锁定时丢弃密钥引用、清除解密后的界面状态并停止依赖明文的后台任务；持久化只留密文。JavaScript 不能保证运行时内存被物理清零。CSV / PDF 是用户主动导出的明文，导出前明确类型；完整备份默认加密，恢复材料另存。

当前基础模块使用浏览器原生 PBKDF2-HMAC-SHA256、600,000 次、随机 16 字节 salt，允许读取的参数范围为 600,000–2,000,000 次；仍需测 iPhone Safari 的实际解锁延迟。未来可以评估经维护的 Argon2id 实现，并通过新版本迁移。对工作量设上下界，拒绝恶意超高参数或静默降级。OWASP 的 600,000 次数字来自密码存储指导，**不是本项目 E2EE 已通过审计的证明**。[OWASP 密码 KDF 指南](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

加密信封必须在解码前限制大小，检查规范化编码、字段和类型；KDF 参数纳入包装认证信息。数据先通过应用校验再加密，解密后仍做边界校验。网络重试可重新发送完全相同的密文信封，但不能复用 nonce 加密变化后的内容。

### 服务器仍能看到什么

认证与同步通常仍暴露账户存在、IP、访问时间、密文长度、修改次数、记录数量、随机 ID、版本 / 删除标记。应减少并说明这些元数据，不能宣称完全匿名。记录中的服药时间、药名、数量、睡眠和症状位于密文中；同步时间不是服药时间。

AES-GCM 可发现密文篡改，**仅靠认证 tag 不能发现服务器回滚整份旧的合法密文历史**。需要区分普通并发冲突、设备已见版本与恶意回滚；新设备如何独立判断最新状态更复杂。首版若不防恶意回滚，应明确限制，不能把普通 revision 检查写成完整反回滚保护。

### 保护范围

在客户端和应用版本可信的前提下，服务器数据库或备份的只读泄露不应直接暴露健康记录。解锁密语强度仍影响离线猜测成本。

E2EE 不防已解锁设备的恶意扩展、操作系统入侵、截图、剪贴板读取或用户导出的明文泄露。纯网页还需信任代码分发来源：**被攻破的服务器若能替换 JavaScript，可能在下次解锁时窃取密钥。** self CSP、开源和 HTTPS 不自动解决这一点；更强威胁模型需要独立可验证客户端分发 / 更新机制，当前未实现。Web Crypto 标准指出，加密 API 本身不会保护脚本执行环境免受注入。[W3C Web Crypto 安全考虑](https://w3c.github.io/webcrypto/#security-considerations)

## 改造顺序与验收

| 阶段 | 需要实现 | 通过条件 |
|---|---|---|
| 1. 密钥模块 | vault 类型、加解密 / 包装、版本与参数限制 | 错密码、篡改密文 / nonce / AAD、错 owner / record / purpose 拒绝；新加密 nonce 不重复 |
| 2. 认证与恢复 | 受控云账户、独立认证与 vault 解锁 / 恢复 | 网络 / 服务端无 vault 密语、数据密钥或客户端恢复密钥；登录重置不能解密 |
| 3. 存储与同步 | 密文表 / API、加密 cache / outbox、冲突 | 两设备并发、离线删除、重试不丢记录；云 API 拒绝旧明文 schema |
| 4. 历史与备份 | 加密 revisions、完整恢复、客户端迁移 | 新设备正确恢复记录、单位、时区和历史；错误材料不覆盖已有数据 |
| 5. HTTPS 边界 | 来源、Secure cookie、CSRF、proxy / 限流、bootstrap | 伪造来源 / 转发头、公开注册和跨账户访问失败；正确同源登录可用 |
| 6. 实机与泄露检查 | Mac、iPhone Safari、锁定 / 重开 / 恢复 | 检查数据库、WAL、网络、IndexedDB、错误路径无健康明文；导出仅用户主动触发 |

测试使用独立合成记录和临时库；正式 SQLite 不用于云迁移试验。服务器不能既做健康内容校验又声称看不到内容：解密后的内容校验属于客户端，服务端仅检查权限、尺寸、协议及版本。不能保留偷偷接受旧明文记录的兼容路径。

GitHub 开源可先做；公网 E2EE 上线等完整链路通过。账户与部署计划见 [自有服务器与学生优惠](./cloud-and-student-plan.md)。idea、需求及设计选择来自 Abraham Zheng；应用代码由 AI（Codex / OpenAI）实现，属于个人实验，未宣称临床验证或独立安全审计。
