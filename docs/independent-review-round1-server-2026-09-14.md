# 第一轮独立安全审查：服务端

审查日期：2026-09-14。任务指定基线：`f6c01e75c29a24a758c4399f1df114aff7dd4045`，分支 `codex/independent-security-review`。本报告先于本轮修复编写，以下代码行均指审查时源码；未执行 Git 操作。没有将 `docs/*review*`、历史报告或已有结论作为发现依据。现有测试是在自行完成源码分析后用于验证，不替代独立分析。

## 结论与证据等级

发现 3 项需要处理的服务端问题：匿名认证上传与全局密文操作共用单一名额、PostgreSQL OPAQUE 登录不清理已过期会话、Caddy 模板将全部用户合并为同一个来源配额。前两项优先修复。没有发现已证实的跨账户读取、未授权恢复/删除、OPAQUE 主密码上传、密文 CAS 绕过或会话到期后仍可访问问题。

| ID | 优先级 | 结论 | 证据 |
|---|---|---|---|
| R1-S1 | P1 / 高优先级可用性 | 未认证的大请求在验证凭据前占用唯一全局 vault 名额，影响所有账户保存/下载 | 源码执行顺序确定；未进行慢请求、DoS 或生产动态验证 |
| R1-S2 | P2 / 中 | PostgreSQL 的正常 OPAQUE 登录保留已过期会话，造成历史行持续累积 | 独立临时 PostgreSQL 与 SQLite 的正常合成到期测试确认 |
| R1-S3 | P2 / 中，限模板部署 | 仓库 Caddy 配置下，全部访问者共享来源注册/登录/挑战配额 | 启动配置、代理模板和来源计算的静态组合确认；未检查实际生产配置 |

P1 表示公开多用户服务上线前应优先修复；这里不表示已经证实生产故障、资源耗尽或数据泄露。授权范围调整后，没有构造或执行拒绝服务流量。R1-S1 的可利用时长、代理缓冲影响、并发容量和生产实际影响均未动态核实。

## 威胁模型

保护对象包括：浏览器加密后的健康记录、包裹的数据密钥、账户/恢复认证记录、OPAQUE 服务端 setup、会话、账户隔离、恢复/删除操作的原子性，以及合法使用者保存和取回记录的能力。

考虑匿名网络访问者、拥有自己正常账户的访问者、失效/撤销会话的持有者、同一账户的并发设备、被篡改的请求字段及密文，以及只读取得数据库副本的人。账户名、账户 ID、显示名、会话摘要/有效期、恢复验证摘要、协议临时状态和密文长度属于服务端可见元数据，不误报为“健康明文泄露”。客户端密码/DEK/OPAQUE export key 应保留在浏览器；恢复只允许独立的授权 secret 到达服务器。

生产 TLS 终止代理、部署目录、数据库管理者和发布者属于不同信任边界。服务器部署者能够替换浏览器代码，数据库/备份管理员能够回滚数据库，本轮没有声称协议可以抵御这些完整控制权限。Local edition 明确是 loopback 上的本机明文 SQLite 应用，不能与公开的 encrypted cloud edition 混为一个威胁模型。

## R1-S1：认证请求体读取早于凭据验证，并占用所有账户共用的密文名额

位置：`server/cloud.mjs:169-170`、`290-298`、`409-416`；`server/cloud-limits.mjs:19-33`；`server/cloud-opaque.mjs:83-87`、`126-140`。

执行顺序如下：

1. `createCloudServer` 创建进程级 `reserveVault = operationGate(1, ...)`。
2. OPAQUE 路由仅根据路径将 `/register/finish`、`/recover/finish`、`/recover/authorize` 等归为 large，并立即占用 `reserveVault`。
3. `/register/finish` 和 `/recover/*` 不先要求现有 session。随后 `body()` 等待请求体完整到达，才进入 `opaque.handle()`。
4. challenge 的查找/消费、恢复 secret 的比较、字段验证和认证工作均在上述等待之后。来源限流主要位于 start 路由，finish 的这一等待阶段不消耗独立的请求来源配额。
5. 所有账户的 `/vault` GET/PUT 共用同一个 `reserveVault`；任何其他占用都会导致这些合法操作返回 429。名额直到处理函数完成并且 response finish/close 才释放。

因此，未验证的公开认证传输与所有已认证账户的保存/下载形成了直接的资源耦合。30 秒 requestTimeout、10 秒 headersTimeout、请求体上限和正确的双条件释放限制了单次资源持有，但没有解决不同信任级别共用唯一资源名额的问题。正确 Host/Origin 是公开客户端可填写的传输要求，不能视为对匿名调用者的身份认证。

具体影响条件：公开认证路由可达；请求处于等待完整正文的阶段；同进程同时发生合法的 vault 操作。本报告不提供攻击脚本，也不声称已测出持续故障时长。Heroku 官方说明请求正文可流式转发，因此不能仅凭“前面有代理”认定源码问题自动消失。[Heroku HTTP routing](https://devcenter.heroku.com/articles/http-routing#request-buffering)

建议：在请求体读取前完成有限的来源准入和方法/路由检查；将未验证上传与已认证密文操作分开限额；只有在 challenge/grant/恢复证明被验证后才申请 vault 操作名额。保留所有现有正文大小、总接收时间、hash 并发、response flush 和 session 再检查机制。调整时必须同时计算上传 JSON、解析对象、数据库返回值及响应序列化的内存上界，不能只是删除限额。

## R1-S2：PostgreSQL OPAQUE 正常登录没有到期会话清理

位置：`server/cloud-postgres.mjs:93-96`、`112-114`、`138-150`；`server/cloud-opaque-postgres.mjs:95`；对照 `server/cloud-sqlite.mjs:110-112`、`199-200`。

PostgreSQL `addSession()` 只执行 INSERT。旧的 legacy `register()`/`login()` 在调用它之前清理过期 session，但当前生产使用的 `loginOpaque()`/`registerOpaque()` 没有经过这些 legacy 方法。OPAQUE 模式下持续正常登录会不断添加新 session；过期 cookie 的访问被拒绝，过期记录本身却不会因后续正常登录被清除。启动迁移又会将整个 sessions 表读入应用内存来收紧旧会话有效期，使无上限的历史行数同时影响存储、启动扫描和内存。

独立正常单元场景（只有临时本地合成数据）：

1. 使用真实 OPAQUE 注册原语建立一个合成账户及正常会话；验证其可访问。
2. 在该合成数据库中把这条会话的创建时刻设为两天前、到期时刻设为一天前，用明确的时钟夹具模拟正常到期。
3. 确认旧 session 查询返回 null，再为同账户正常调用 `loginOpaque()` 建立新 session。
4. 查询原来那条过期 session 是否仍存在。

实测结果：

| 后端 | 过期 cookie 被接受 | 新 session 可用 | 正常重新登录后原过期行 |
|---|---:|---:|---:|
| PostgreSQL 18 临时实例 | 否 | 是 | 1 |
| SQLite 临时文件 | 否 | 是 | 0 |

证据脚本：`/private/tmp/independent-r1-expiry.mjs`；运行包装：`/private/tmp/independent-r1-run-pg.sh`。这些脚本显式只允许 loopback 和独立 `round1_synthetic` 数据库。数据库、集群、socket 目录在退出时清理。这个测试证明到期清理缺失，不证明会话认证可绕过；没有把访问过期与物理删除混为一谈。

建议：为 OPAQUE 建立有界、可重复的到期清理，优先放在取得账户锁之前，保持 account → session → vault 的锁顺序。避免在已有账户锁内执行对所有账户的 session 清理；为到期清理添加正常过期/仍有效会话并存的回归测试，同时验证回滚和跨连接撤销语义。启动时先处理已到期历史，再分批处理仍需收紧期限的旧数据，避免无界读入历史 session。

## R1-S3：Caddy 模板部署下所有用户共用来源配额

位置：`deploy/Caddyfile:4-9`、`deploy/drug-tracker.service:15`、`server/cloud.mjs:58`、`163-166`、`483-491`、`server/cloud-limits.mjs:8-15`。

提供的 Caddy 模板将请求转发至 `127.0.0.1:4312`，systemd 模板启动普通 cloud CLI。该 CLI 没有声明可信 Caddy 代理模式，源码当时只支持 `proxyMode: 'heroku'`。普通模式以 `req.socket.remoteAddress` 作为来源，因此 Caddy 转发的不同访问者均被识别为同一 loopback 地址。

这使正常用户共同承担来源层面的注册 10 次/小时、OPAQUE login/recover start 120 次/15分钟，以及同来源 pending challenge 上限 40；未知用户名还共享更小的 unknown-source 配额。账户级配额仍然分别存在，因此这不是账户身份混淆或认证绕过，而是受支持多用户部署的可用性和配额隔离缺陷。极少量正常用户活动也可能使其他访问者遇到限额。

建议：如果继续支持该模板，增加显式的 trusted-loopback 代理配置，只在连接的直接对端确为 loopback 时使用可信代理清洗/追加的来源字段；Caddy 模板必须与取值规则一起定义、校验。不要让任意请求头开启代理模式，不要默认信任 X-Forwarded-For 最左端。若不实现，则在模板中准确说明全部用户共享额度及适用规模，不能描述成按真实客户端隔离。Heroku 的右端追加规则已在官方文档核查，但不应自动套用于其他代理。[Heroku headers](https://devcenter.heroku.com/articles/http-routing#heroku-headers)

## 完整服务端源码覆盖

以下 13 个文件均逐行阅读（共 2,480 行）。

| 文件 | 范围与结果 |
|---|---|
| `server/cloud.mjs` | 全 497 行；配置、TLS 代理提示、Host/Origin/Fetch Metadata、cookie、session owner、路由、正文读取、门限、静态资源、错误及关闭。R1-S1、R1-S3；未发现已确认 owner 绕过或请求路径读私有文件。 |
| `server/cloud-opaque.mjs` | 全 186 行；setup、二进制规范编码、注册/登录/reauth/恢复/改密/旋转/迁移/删除。challenge 一次消费且绑定用途/来源，敏感 grant 绑定 owner/session/authVersion。没有主密码/export key/DEK 正常入口。 |
| `server/cloud-opaque-postgres.mjs` | 全 152 行；setup advisory lock、challenge admission、消费事务、身份版本、密文/凭据提交、回滚/删除。没有确认跨账户或 stale grant 提交。涉及 R1-S2。 |
| `server/cloud-postgres.mjs` | 全 225 行；TLS 配置覆盖防护、连接池、迁移、SQL 参数化、账户/会话锁、CAS、配额和关闭。R1-S2；正常跨进程 OPAQUE 和回滚测试通过。 |
| `server/cloud-sqlite.mjs` | 全 344 行；专用 DB 检查、版本迁移、setup、challenge、BEGIN IMMEDIATE、session、CAS、改密/恢复/删除和旧接口。到期登录会清理；未发现与 PG 身份/密文事务隔离相矛盾的安全绕过。 |
| `server/cloud-limits.mjs` | 全 34 行；IP 合法性/IPv6规范化、Heroku 右端来源、双条件并发释放。R1-S1、R1-S3。 |
| `server/cloud-session.mjs` | 全 9 行；24 小时及创建时刻的非滑动上限，坏创建时间返回无效。没有发现重启续期。 |
| `server/cloud-errors.mjs` | 全 3 行；内部错误类型和受控响应详情。未发现请求内容日志路径。 |
| `server/vault-store.mjs` | 全 147 行；owner、精确字段及descriptor、base64url规范性、长度、固定KDF、CAS、SQLite、关闭。正常原语测试通过。只验证密文结构，不能也不应声称服务端已验证 GCM 真实性。 |
| `server/heroku.mjs` | 全 38 行；必须明确 PostgreSQL/HTTPS origin，禁止本机降级，pool 限制、关闭期限。未访问真实 Heroku 配置。 |
| `server/index.mjs` | 全 769 行；本机认证/恢复、CSRF/Host、本机 cookie、记录 owner、修订/软删除、导入/导出、静态资源、迁移/关闭。没有发现已确认的跨 owner 读取/写入或已撤销 session 的延迟写入绕过。 |
| `server/migrations/001_initial.sql` | 全 44 行；local users/sessions/entities/revisions、FK cascade 与 owner 索引。未发现删除遗漏 FK。 |
| `server/migrations/002_inventory.sql` | 全 32 行；在外部 migration transaction 内完整复制再替换两张表，未发现半迁移成功路径。 |

辅助协议/配置阅读：`src/lib/opaque-client.ts`（全）、`src/lib/cloud-opaque-flow.ts`（全）、`src/lib/cloud-session-restore.ts`（全）；`src/lib/cloud-client.ts` 的网络发送、注册、登录、恢复、敏感操作和重试段；`src/lib/vault-crypto.ts` 的独立恢复 secret/DEK 打包与读取；`src/lib/password-policy.mjs` 的调用边界；`package.json`、OPAQUE 声明文件和 pg TLS 连接实现相关段；`deploy/Caddyfile`、`deploy/drug-tracker.service`、`vite.config.ts`。只核对 `PRIVACY.md`/`SECURITY.md` 中实际认证元数据与期限的边界说明，没有读取历史审查文档。

## 没有发现已确认问题的检查

- **认证/恢复：** OPAQUE 消息有固定字节数和规范 base64url；服务端使用 owner ID 作为 OPRF 身份、明确 client/server identifiers。假账户登录不返回 owner。setup 稳定保存，已有 OPAQUE 账户缺 setup 时关闭失败而不静默换 setup。恢复先验证独立 32 字节 secret，只有授权后返回 vault；完成恢复绑定授权快照的 revision、旧 recovery hash 和 authVersion，正常流程更换 DEK、凭据、session。服务端只收到 recovery 授权 secret，完整 recovery code 和 DEK 留在客户端。
- **敏感操作：** delete/logout-all/change/rotate 的 reauth grant 区分 action、owner、session、authVersion 和来源；challenge/grant 一次消费。改密保留现有 data ciphertext 与 recovery verifier；旋转保持 OPAQUE record；恢复和改密在同一个仓库事务提交，任何尾部 session 插入失败都会回滚。这里没有声称服务端能证明客户端生成的新密文确实对应原明文。
- **会话与撤销：** 高熵随机 cookie，仅保存摘要；云 cookie HttpOnly/Secure/SameSite=Strict，受 /drug/ 路径限制；重复同名云 cookie 被拒绝；cloud owner header 必须匹配。24 小时上限不在查询/重启时续期。到期测试两后端均拒绝旧 cookie；已撤销会话延迟写入的既有正常回归通过。撤销不会抹除另一个浏览器已经收到的明文。
- **事务/CAS：** SQLite 的同步 BEGIN IMMEDIATE 事务串行化读改写。PG 用 account → session → vault 的固定顺序，owner 写锁保护首次 vault INSERT 和后续 revision CAS，session share lock 使已启动的合法写入与 logout 的返回有明确顺序。恢复/改密/删除重验版本和会话；所有外部数据值使用 SQL 参数。普通 vault 写入不能替换当前 OPAQUE wrapped key，跨 owner envelope 被拒绝。PG 锁语义按官方资料核查；未将默认 READ COMMITTED 误称 SERIALIZABLE。[PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- **删除/导入：** cloud 删除账户同时删除 vault、sessions、challenges；local cascade 删除实体及修订。local 导入先完整校验再事务写入，并在 replace 删除前检查 foreign-owned IDs。软删除保留修订是数据模型行为，导出明确包含历史，不误报为硬删除承诺违约。
- **静态文件：** cloud 启动时有 edition marker、数量/体积/深度边界，snapshot 后请求不再访问文件路径；拒绝 leaf symlink/FIFO/不稳定读取，asset walk 不跟随 symlink；API/HTML/密文保持 no-store，仅公共哈希资源缓存/压缩。decode 后拒绝路径跳转组件及反斜线/NUL；private DB 路径不进入路由。local 静态读取仍信任可读的 dist 树，见限制。
- **传输/错误：** cloud 写请求要求精确 Origin，Host 和 cross-site Fetch Metadata 独立检查；proxyMode 来自服务端配置。Heroku proto 只作为 TLS 提示，不作 owner/origin；forwarded host 不参与认证。PG URL 查询参数不能覆盖 host/user/TLS/CA；云模式默认校验证书，关闭 TLS 仅显式数字 loopback 测试。错误响应不返回 SQL/堆栈/请求正文，日志无凭据/健康明文。
- **资源界限：** 云正文拒绝压缩，检查 declared size 和实际字节数，UTF-8 严格解码，密文/KDF 参数固定，hash工作最多2并发；挑战库有总量/来源/用户名上限和TTL。request/headers timeout 非零；这些控制真实存在，但不能据此排除 R1-S1 或下列容量疑点。[Node HTTP request timeout](https://nodejs.org/docs/latest-v24.x/api/http.html#serverrequesttimeout)

## 验证记录

独立 PostgreSQL 18 集群位于随机 `/private/tmp/independent-r1-pg.*`，监听 `127.0.0.1` 随机端口。到期测试数据库为 `round1_synthetic`，现有 PostgreSQL 集成测试自己建立随机 `drug_opaque_*` 数据库；没有读写工作区 `data/`、生产 URL、生产数据库或真实账户。

本轮执行的 5 个现有测试文件：`tests/cloud-postgres-opaque.test.mjs`、`tests/cloud-sqlite-opaque.test.mjs`、`tests/cloud-opaque-client-chain.test.mjs`、`tests/local-session-revocation.test.mjs`、`tests/vault-store.test.mjs`。结果 **37 passed、0 failed、0 skipped**，约 11.9 秒。覆盖真实 PAKE、两种数据库、跨连接隔离、恢复/改密/删除、事务回滚、正常重试、修订冲突及被撤销请求的正常回归。另有上文独立过期会话比较测试，断言全部通过并确认 R1-S2。

未运行流量压力或资源耗尽测试。既有 local session 回归包含用于检查 logout/reset 正确顺序的短暂正文分段夹具；它用于验证授权撤销，未作为 DoS 复现或延长连接压力使用。没有云服务探测、生产状态检查、部署、提交或推送。

## 未验证疑点与剩余限制

1. `/login/finish` 返回完整 vault，却按普通 auth gate（8）分类，其他大响应走 gate（1）。密文达到允许上限、响应等待 flush 时的总内存预算未测。应把大响应也纳入加固后的统一计算，不能只看上传路由。
2. PostgreSQL rate_limits 没有与 SQLite 内存 Map 的 10,000 条相等的全局条目上限。真实来源高度分散时的配额表规模、过期扫描和连接池等待队列容量没有进行负载验证。IPv6仅规范拼写、不聚合网段；是否需要网络级聚合应依据部署来源和误伤风险决定。
3. 普通 cloud 的 GET /session 等轻请求在数据库层没有独立 admission gate。是否形成可用性问题需要有授权的容量测试；不能仅凭“缺一个 limiter”推导生产故障。
4. cloud 静态 snapshot 在启动期间依赖上级目录可信且不可被不受信用户修改；代码注释明确这一前提。local 静态服务使用 stat/read 并跟随 dist 内 symlink；没有构造本机目录替换，也没有把已拥有相同文件系统权限的攻击者当作无权限远程攻击者。
5. 没有独立审计 OPAQUE WASM/底层 Rust 或证明其具体实现与 RFC 9807 字节级完全一致；本轮只审 API 使用、消息边界和状态机。RFC 9807 对客户端 KSF、身份绑定和账户枚举边界用于交叉核查，不能代替该库的密码学审计。[RFC 9807](https://www.rfc-editor.org/rfc/rfc9807.html)
6. 没有验证生产代理链、TLS 证书链、Heroku runtime 配置、备份保留/恢复、数据库权限、真实主机磁盘权限、集群故障转移、时间跳变或 DNS/域名所有权。到期测试证明应用认证期限，并不证明数据库页/WAL/备份的法证擦除。
7. 本轮没有发现高危数据访问漏洞不等于不存在漏洞。上述覆盖限定于列出的源码和动态测试，第二轮应在修复后由独立视角复核。

## 修复交接

此处记录的是发现时状态。root 已授权随后做防御性修复及普通回归；后续改变应在本报告追加，保留以上基线发现和“未做 DoS 动态复现”的边界，不用修复后的测试倒推基线没有问题。

## 第一轮防御性修复追加（2026-09-14）

基线报告完成后，按 root 后续授权实施以下修复；没有部署或 Git 操作。

- **R1-S1：** OPAQUE 路由先检查允许的方法/路径，再为 POST 消耗独立的来源接收配额（默认每来源 480 次/15 分钟；不消耗有效账户尝试的预算），随后才读取正文。未验证的大正文使用单独的 1 名额。协议层只有在查找/消费并验证 challenge、grant 或恢复证明后才调用 `withVault`，因此缺失/失效 challenge 不会取得受保护 vault 名额。`/login/finish` 的完整 vault 下载及安全操作中读取 vault 的步骤也经过受保护名额。原有正文大小、request/headers timeout、hash 并发和 handler + response 两条件释放均保留；仓库事务依旧复核 session/authVersion。普通服务层单元测试验证失效 challenge/失败恢复不进入受保护工作、真实注册和登录可以正常进入。
- **R1-S2：** PostgreSQL 注册/登录路径（含 OPAQUE）在取得账户锁之前做最多 1,000 行的过期 session 清理，使用 `FOR UPDATE SKIP LOCKED` 避开在途会话操作。启动也做同样的有界清理，且只将仍未到期 session 读入应用执行旧期限收紧，避免加载全部已过期历史。SQL statement/lock timeout 保持原值；不存在在账户锁内做跨账户全表清理的新路径。新增正常到期/登录/注册回归验证旧行消失，同时其他有效设备 session 保留。
- **R1-S3：** 新增显式 `CLOUD_PROXY_MODE=caddy-loopback`。直接对端必须是 loopback；仅此模式读取 Caddy 覆盖设置的单值 `X-Drug-Client-IP`，忽略客户端的 X-Forwarded-For；未经配置仍用 socket 地址。Caddy 模板通过 `header_up X-Drug-Client-IP {remote_host}` 覆盖传入值，环境模板配套启用。HTTPS Origin 和 `X-Forwarded-Proto=https` 仍必须满足；Heroku 拒绝这一仅供本机代理的环境设置。模板明确 Caddy 必须是公网边缘，不自动信任未经审查的 CDN 链。[Caddy header overwrite](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers) 与 [remote_host placeholder](https://caddyserver.com/docs/caddyfile/concepts#placeholders) 已按官方资料核查；没有运行实际 Caddy 实例。

实际修改文件：`server/cloud.mjs`、`server/cloud-opaque.mjs`、`server/cloud-postgres.mjs`、`server/cloud-opaque-postgres.mjs`、`server/cloud-limits.mjs`、`server/heroku.mjs`；`deploy/Caddyfile`、`deploy/.env.example`；新增 `tests/cloud-admission.test.mjs`，更新 `tests/cloud-postgres-opaque.test.mjs`、`tests/cloud-postgres.test.mjs`、`tests/heroku-config.test.mjs`。

### 修复后验证

独立新临时 PostgreSQL 集群完成 **58 passed、0 failed、0 skipped**（约 12.2 秒）。覆盖新增 2 个普通 admission/Caddy 单元测试、正常 OPAQUE 到期清理回归、原有真实 PostgreSQL/SQLite 事务和客户端链路，以及原有 session 锁/断开连接释放的短暂合成回归；没有构造新的慢请求/压力/拒绝服务测试。

修复后的独立会话过期比较：PostgreSQL 和 SQLite 均拒绝过期 cookie；正常新 session 均可用；重新登录后的原过期行两者均为 **0**。保留基线脚本不变，修复后断言脚本另存 `/private/tmp/independent-r1-fixed-expiry.mjs`，包装为 `/private/tmp/independent-r1-verify-fixed.sh`。临时集群和合成数据库在结束后清理。

### 容量与尚未验证的边界

当前界限为 **1 个受保护 vault 操作 + 1 个尚未验证的大 OPAQUE 正文**。`VAULT_BODY_LIMIT` 是 21,337,451 字节（约 20.35 MiB），不等于单请求的总内存。HTTP chunks、`Buffer.concat`、UTF-8 解码、`JSON.parse`、密文 base64 解码/再编码、数据库序列化/返回、`JSON.stringify` 和响应缓冲可能同时占用多份内存；因此不能把 2 × 20.35 MiB 当作进程 RSS 上界。**未对 512 MiB dyno 做极限正文的内存或负载验证，不声称这个预算已获得生产容量保证。** 需要第二轮/后续授权容量验证决定是否改为更小正文限额或流式/分块存储。

大 OPAQUE 上传之间仍共用一个接收名额；此取舍保护普通已登录 vault 读写和已验证登录下载，同时维持两个大请求的明确上限。已经认证的普通 vault PUT 仍在读取正文期间持有受保护名额，原有 30 秒接收超时继续约束它；没有宣称按所有用户实现公平调度。大量分散来源的配额表规模及轻请求连接池等待仍属前述未验证容量限制。

以上修复和验证已经完成，可交由独立的第二轮服务端审查者复核；本报告不代替第二轮结论。
