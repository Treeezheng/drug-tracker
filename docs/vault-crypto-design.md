# 单密码、恢复码与云端加密

核对日期：2026-09-13。本轮源码采用一个主密码完成 OPAQUE 认证和本地解密；生产界面及服务端不开放旧双密码登录/迁移。这里描述已实现协议和合成测试，不表示该版本已部署、取得第三方审计或达到 Apple 的产品安全水平。

## 认证与密钥分离

固定依赖 `@serenity-kit/opaque` **1.1.0**，使用其既有 Rust/WASM OPAQUE 实现，没有自写 PAKE、AES 或随机数算法。正常客户端仅向 `/auth/opaque/*` 发送 OPAQUE 消息，**不发送主密码、client state、export key、数据密钥或完整恢复码**。普通登录即使遇到未知账户或旧服务，也不回退到原始密码接口。[OPAQUE RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)、[库源码与 API](https://github.com/serenity-kit/opaque)、[官方 export-key 说明](https://opaque-auth.com/docs/advanced_usage/export-key)

客户端固定 OPAQUE key stretching：Argon2id **64 MiB、3 passes、1 lane**。配置写在客户端代码中，不接受服务器任意提供较低/较高成本参数。身份绑定为规范 username 和固定 server identifier `drug-tracker:opaque:v1`，服务端 OPRF userIdentifier 为稳定 owner ID。OPAQUE server setup 是长期服务器秘密：数据库事务生成/保存，已有 OPAQUE 账户却缺失 setup 时拒绝启动；不得随重启重建或随意更换。

OPAQUE 返回两种不同材料：双方共享的 `sessionKey` 仅属协议会话；**只有客户端得到的 64-byte `exportKey` 才用于包装 DEK**。本应用不使用 shared session key 加密记录。服务端仅保存 OPAQUE registration record、恢复认证部分的哈希、会话及公开账户元数据；数据库含 OPAQUE setup，并不意味着其能直接得到 export key。

库曾有公开的 2023 年安全评估，但该报告不等于对最新 1.1.0 或本应用组合协议的独立审计。[原始评估报告](https://7asecurity.com/reports/pentest-report-opaque.pdf)

## v3 包装与数据加密

Web Crypto 生成独立随机 AES-256-GCM 数据密钥（DEK）。每次数据加密和包装均重新生成 12-byte IV；GCM tag 128 bit。随机 nonce 的碰撞概率极低但不是数学意义的零。[Web Crypto](https://www.w3.org/TR/webcrypto/)

数据仍是 v1 envelope：

```ts
{protocol:'dose-timeline-vault',version:1,kind:'data',ownerId,
 cipher:'AES-256-GCM',iv,ciphertext}
```

OPAQUE 账户只写 v3 wrapped-key envelope：

```ts
{protocol:'dose-timeline-vault',version:3,kind:'wrapped-key',ownerId,
 cipher:'AES-256-GCM',iv,ciphertext,
 kdf:{name:'OPAQUE-export',hash:'SHA-256',
      context:'drug-tracker:opaque:v1',salt}}
```

使用 Web Crypto HKDF-SHA-256，把客户端 export key、随机 16-byte salt 和下列 UTF-8 JSON info 派生为不可导出的 AES-GCM KEK：

```ts
['dose-timeline-vault',3,'opaque-export-wrap','AES-256-GCM',ownerId,
 'drug-tracker:opaque:v1']
```

数据与包装各自的 AAD：

```ts
['dose-timeline-vault',1,'data','AES-256-GCM',expectedOwnerId]
['dose-timeline-vault',3,'wrapped-key','AES-256-GCM',expectedOwnerId,
 'OPAQUE-export','SHA-256','drug-tracker:opaque:v1',salt]
```

每层字段、版本、算法、owner、salt、IV 与 ciphertext 长度严格校验；二进制要求 canonical base64url 无 padding。包装 ciphertext 精确 48 bytes（32-byte DEK + tag）。owner 来自已确认账户，不从不可信 envelope 自行推断。profile、doses、scenarios、favorites、checkins、inventory 全部在同一密文里；药物、剂量、备注、睡眠、时区不进入外层 metadata。

JSON 先累计真实 UTF-8 字节及转义/标点，再复制、编码，最大 16,000,000 bytes；深度32、遍历值500,000、单数组50,000、单对象100字段、单字符串1,000,000 UTF-16 units。拒绝 getter、循环、非有限数和危险字段。解密后另经医学记录 schema 校验，不能把认证通过的任意 JSON 直接当应用数据。

## 一个恢复码，两份独立随机秘密

```text
DTR1.<ownerId>.<32-byte auth token base64url>.<32-byte DEK base64url>
```

两部分独立随机生成。服务器只保存 `SHA-256(decoded auth token)` 的 lowercase hex64；恢复授权时只收到 auth token 部分，**永远不收到 DEK 部分或完整码**。完整码等同敏感凭据，应保存到用户自己的安全位置，不放 URL、浏览器持久缓存或遥测。复制/下载是用户明确动作，下载文件为明文秘密。

恢复先凭 auth 部分获取受限恢复授权及旧密文，随后浏览器验证 owner/username，并用 DEK 真正解开旧密文。成功后生成新 DEK、新 auth token、新 OPAQUE record 和新包装；服务器在一次事务里 CAS 替换完整组合并撤销全部旧 session。错误 DEK 不会提交账户更改。恢复码不由运营者补发；主密码和恢复码都丢失时无法恢复记录。

- **Change password**：新鲜 OPAQUE 重新认证后，创建新的 OPAQUE record/export key，以新 salt/IV 包装原 DEK；数据 ciphertext 和恢复码保持不变；所有旧会话撤销。
- **Replace recovery key**：新鲜 OPAQUE 重新认证后，生成新 DEK 并重加密当前记录，生成新 auth token；保留当前 OPAQUE record，以当前 export key 包装新 DEK；旧会话撤销。
- 旧恢复码不能恢复/解密轮换后的新版本，但旧密文副本和已泄露明文不能被撤回。只改密码没有更换 DEK，因此不撤销已泄露的旧 DEK。

## 主密码规则与内存

新主密码为 **15–256 个 Unicode codepoints，zxcvbn 分数4/4**，拒绝常见密码及装饰性常见变体。密码不 trim、不 normalization、不截断，拒绝孤立 surrogate。估计器只分析前256 UTF-16 units；整个密码参与 OPAQUE。密码管理器生成的独立随机密码更合适。字典以英文及常见模式为主，不是所有语言/泄露库的穷尽验证。

策略只在客户端执行：服务器从来拿不到新主密码，无法诚实宣称在服务端检查其长度/评分。zxcvbn 字典与 WASM 都随本站构建，不调用第三方密码服务或 CDN。[zxcvbn-ts](https://zxcvbn-ts.github.io/zxcvbn/guide/getting-started/)

OPAQUE/旧 Argon2 每次计算在一次性同源 Worker 里运行，锁定中止 Worker；CSP 只为 WebAssembly 允许 `wasm-unsafe-eval`，没有允许 JavaScript `unsafe-eval`。client key、解密数据、待确认恢复码仅驻内存；没有账户明文 IndexedDB/localStorage/outbox。临时 byte arrays 尽量擦除，但 JavaScript 字符串、GC 副本、CryptoKey 内部不能承诺物理清零。

## 兼容范围与失败语义

旧 v1 PBKDF2-SHA256（600,000–2,000,000 iterations）、v2 Argon2id（64 MiB/3/1）解密原语保留，供旧加密材料及显式合成回归使用。旧 raw-password 注册、登录、改密、迁移在生产关闭；测试 fixture 必须显式开启，不提供产品迁移向导。

原子 finish 丢 ACK 时，客户端用新密码再做 OPAQUE 登录，只有新包装精确匹配并真正解密通过才确认并返回原恢复码。网络仍不可用时，仅内存保留待确认组合并阻止普通保存；同密码重试先对账。一个临时随机 salt + SHA256 tag 仅用于识别同进程未确认操作的输入是否相同，不是服务器认证材料，也不用于密码派生/加密。关闭会清除此状态；若服务器已提交，新密码仍能登录，随后可以再生成恢复码。确认前保留新旧密码。

## 安全承诺的边界

正常部署代码下，数据库保存密文和认证材料，运营者没有直接解密密钥。**能替换网页 JavaScript 的恶意运营者、XSS、被污染的构建/依赖、浏览器扩展或被控制设备仍可窃取输入和已解锁数据**。因此不能承诺对主动恶意网页供应者绝对保密。OPAQUE 不消除弱密码的离线猜测风险；数据库及服务端秘密泄露后仍需考虑昂贵但可能的字典攻击。

同一已开认证会话会拒绝已观察到的更低 revision；新浏览器/刷新后没有独立可信最新版本锚点，无法彻底阻止恶意服务器回放、删除或拒绝服务。会话/账户标识、IP、访问时间、密文大小仍为可见元数据。访客默认仅内存，18岁声明后主动 Remember 的模拟草稿为明文 localStorage；本机 SQLite、导出的 CSV/JSON 也不属于云密文承诺。

## 本轮验证

`opaque-primitives.test.ts` 7项：真实1.1.0注册/登录、稳定 export key 与 shared session key 分离、v3包装、身份/owner绑定、篡改、恢复两部分及摘要、取消。

`cloud-opaque-client-chain.test.mjs` 8项实际HTTP/临时SQLite组合流程：注册/登录/记录、改密/恢复/轮换/旧会话撤销、错误DEK不提交、旧副本边界、丢ACK与二次连接失败、同材料重试、预提交失败与同主密码恢复重试、并发CAS、锁定晚响应、fresh-grant注销/删除、仅显式fixture旧迁移。正常新协议请求和临时DB/WAL检查未见合成主密码、DEK、完整恢复码或健康明文。另67项主密码规则与旧协议/客户端兼容回归通过；六个专项文件合计82/82，0失败/跳过。

这些都是本地合成测试；生产TLS、真实iPhone/Safari与Worker/CSP验收由集成记录另述，不能把测试数量当作独立安全审计。
