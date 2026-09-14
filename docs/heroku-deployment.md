# Heroku 部署与验证

核对日期：2026-09-13。应用 **drug-tracker** 已部署。主任务已在浏览器验证 `https://treeezh.com/drug` 返回 200、HTTPS 正常，根地址返回 302 并转到 `/drug/`。用户已批准并开通 Basic web dyno 与 Essential-0 PostgreSQL，基础费用约 **$12/月**。生产 PostgreSQL 显示 **18.3 / Available**；此前已在保留严格 TLS 校验的配置下确认启动日志进入 up。这里记录主任务的线上验收事实，服务端审查子任务没有读取生产数据或凭据。

本轮单密码 OPAQUE、恢复码、会话和限流增强已通过本机合成测试，仍需随本轮 PR 合并发布并重新验收。域名返回 200 不代表这些新增功能已经在线。旧 SQLite 记录没有自动迁入云库。

## 运行方式和已批准费用

本机 `pnpm dev / build / start` 继续使用本机版；自建服务器的 `server/cloud.mjs` 使用独立 SQLite 云库。Heroku 的 `Procfile` 单独运行 `server/heroku.mjs`：Node 24、平台提供的 `PORT`、监听 `0.0.0.0`，仅 PostgreSQL，不会在数据库未配置时退回 SQLite。Dyno 磁盘随重启和部署丢失，不能保存正式数据库。[Heroku 文件系统](https://devcenter.heroku.com/articles/how-heroku-works)

当前为 **一个 Basic web dyno + Essential-0 PostgreSQL**。用户已批准 **$7 + $5 = $12/月** 的基础费用，未扣学生额度、未计税和额外资源。这不是新的购买授权，不要求重新开通同类资源；未批准自动扩容、Review Apps 或额外收费附件。实际账单以 Heroku 账单为准。[Dyno 价格](https://www.heroku.com/pricing/)、[PostgreSQL 价格](https://elements.heroku.com/addons/heroku-postgresql)

Essential-0 有 1 GB 存储与 20 个连接。每个进程默认连接池上限 4；扩容时须计入新旧 dyno 与维护连接，不能把单进程连接池误当整个数据库限制。[Essential 规格](https://devcenter.heroku.com/articles/heroku-postgres-plans)

## 当前配置与后续发布

1. 已连接 **Treeezheng/drug-tracker → main**，Heroku 对 `main` 的自动部署已开启。GitHub `main` 保护已配置为必须通过 **Verify** 并经 PR 合并；CodeQL default setup 也已配置。本轮工作流提交后才会触发新增 Verify，须查看首次执行结果，不能把配置已开当成测试已过。
2. **Resources** 当前为已批准的 Basic web dyno 和 Essential-0 PostgreSQL。复核已有资源，不新建第二个数据库。`DATABASE_URL` 由附件提供，不要把内容发到聊天、提交到 GitHub 或写入日志。
3. **Config Vars** 当前设置 `CLOUD_ORIGIN=https://treeezh.com`，末尾没有斜线，也没有 `/drug`。`DATABASE_POOL_SIZE` 为 4，默认 CA bundle 路径由入口设置；参见 [配置示例](../deploy/heroku.env.example)。不手动设置 `PORT`、`DYNO`、本机 SQLite 路径、开发 HTTP 开关或加密密码。
4. 后续更改创建 PR，待 Verify 和其他已配置检查完成后合并 `main`，由自动部署发布。Node buildpack 使用 `package.json` 和唯一的 `pnpm-lock.yaml`，Node 固定 `24.x`，pnpm 固定版本。`heroku-postbuild` 强制 `/drug/` 和 cloud edition，构建不连接数据库。Cloud Native 的 `heroku-build` 只提示，实际编译仍统一在 `heroku-postbuild`；`Procfile` 避免误用本机 `start`。[GitHub 集成](https://devcenter.heroku.com/articles/github-integration)、[Node 支持](https://devcenter.heroku.com/articles/nodejs-support)、[Classic 构建](https://devcenter.heroku.com/articles/nodejs-classic-buildpack-builds)、[Cloud Native 构建](https://devcenter.heroku.com/articles/nodejs-cloud-native-buildpack-builds)
5. 在 **Activity** 检查对应提交的构建结果，在 **Resources** 确认 web dyno 启动。数据库初始化使用 PostgreSQL 事务和 advisory lock，空库允许网页注册，不预置管理员密码或把加密密码放进 Config Vars。
6. 访问 **[实际应用](https://treeezh.com/drug/)**。`https://treeezh.com/` 现会 302 转到 `/drug/`；`/drug/api/edition` 应返回 `{"edition":"cloud"}`。旧 Heroku 默认域名返回 403 是精确 Host/Origin 策略的预期结果，不应为此放宽白名单；本机 `/api/*` 在云端不存在。

Verify 定义包含锁定依赖、TypeScript、TS/服务端测试、临时 PostgreSQL 18 服务，以及分别构建本机和云版。本轮也准备了重复构建比对与构建清单证明流程；提交后须看实际运行结果。PR 保护、CodeQL 设置与 Heroku 自动部署是已确认的配置，新的绿色运行、合并和部署仍须逐项观察。见 [GitHub 验证配置](github-verification.md)。

## 发布验收

使用合成记录验证游客模拟与刷新保留、单密码注册和重新登录、保存后刷新解锁、并发冲突、锁定与注销、错误密码拒绝。安全操作还需验证恢复码恢复、退出所有设备、改密码、轮换恢复码和删除账号；尤其测试提交已成功但回包中断后的重试。失败操作不能丢失已确认记录；重启 dyno 后账号、OPAQUE setup、恢复验证摘要和密文应保留。普通 vault 请求只有版本化密文、包裹密钥及版本；认证只传 OPAQUE 消息，恢复授权只传恢复码的独立账户部分，不含原始密码、药名、剂量、笔记、完整恢复码或数据解密密钥。

生产域名 HTTPS、根跳转以及严格 TLS 配置下的已有启动已由主任务确认。下一版仍须复核构建提交、Verify/CodeQL 结果、会话和加密操作、部署后数据保留。本机测试不能代替每次发布的现场检查，一次启动成功也不能证明备份与保留期限符合要求。

应用日志不打印请求正文、凭据、密文或异常堆栈。Heroku router 仍会记录 URL、状态、时间和网络元数据，平台也可能生成 NEL 报告；不要把秘密放入 URL。查询参数遮蔽、日志接收方与保留期限是独立的平台设置，不能由“应用无分析代码”推断。[Heroku 路由与日志](https://devcenter.heroku.com/articles/http-routing)

## 本轮数据与安全边界

- PostgreSQL 保存用户名、显示名、OPAQUE 密码文件与持久 setup、认证版本、独立恢复验证摘要、会话令牌摘要与期限、挑战状态、配额摘要及密文元数据。健康记录只有浏览器产生的 `dataEnvelope`，随机数据密钥只以 v3 `keyEnvelope` 包裹保存。新协议不接收原始密码、client export key、完整恢复码或数据密钥。setup 和数据库处于同一安全边界；整库被盗仍可进行离线猜密码。
- 事务采用 **owner → session → vault** 一致锁顺序。OPAQUE 证明在有界工作槽中验证，提交事务内再次检查认证版本、当前会话及对应恢复验证摘要。会话、短时挑战与 CAS 版本在所有实例共享，数据与包裹密钥整体更新。已撤销会话的迟到写入不能复活记录，过期会话清理不与账户锁交叉持有。
- 移除会被少量请求耗尽的全站定时限额。已有用户名按摘要分别限制登录和敏感密码验证；未知用户名按来源合并，注册按来源另设额度。仅 Heroku 配置读取路由器追加在 X-Forwarded-For 最右侧、通过格式校验的 IP，用于配额而非身份；忽略可伪造的左项。PG 共享配额，并于后续配额操作清理已到期项。摘要是化名化元数据，不是匿名保证。
- 每进程最多 2 个密码学操作、8 个账户请求及 1 个大型密文操作。新密码强度只在客户端本地评分，服务器未收到密码，不能再次评分。挑战期限 120 秒，待完成挑战最多全局 1000、来源 40、用户名 12；已消费挑战不会重置累计来源/账号额度。等待 SQL 的请求即使断线也不提前释放大操作名额。来源/用户名配额仍不能完全阻止分布式流量，共享 NAT 的用户也可能共享注册额度。
- 云会话绝对期限缩至 24 小时；旧 session 以原创建时间加 24 小时封顶，不因重启续期。新的敏感操作使用用途绑定的一次性 OPAQUE 重认证授权；改密码撤销所有旧 session，仅签发新的当前 session，保留数据密文和恢复码。退出所有设备同时增加认证版本，已取走的旧登录挑战也不能重新建立 session。恢复或轮换恢复码还会更换 DEK、密文和恢复验证摘要。删除在同一事务中移除该账户、vault 和全部 session，不删除其他账户；备份、已导出文件和历史副本不承诺即时物理擦除。
- 新单密码由客户端检查 15–256 Unicode 码位、zxcvbn 4 分，OPAQUE 客户端 KSF 固定 Argon2id 64 MiB、3 轮、parallelism 1；新 wrapped-key v3 用 client-only export key 派生 HKDF-SHA256，data envelope 仍为 AES-256-GCM v1。生产禁用旧 raw-password API、迁移入口和 CLI bootstrap，不自动删除旧数据；v1/v2 仅保留显式合成测试兼容。仅云应用 CSP 允许 WebAssembly 专用 `wasm-unsafe-eval`，不允许 JavaScript `unsafe-eval`。完整接口见 [Cloud API](cloud-api.md)。
- 数据库 TLS 最低 1.2，验证证书与主机名，**不使用 `rejectUnauthorized:false`**。当前 Essential 文档支持 RDS 证书和 buildpack CA bundle `/usr/lib/ssl/certs/ca-certificates.crt`；其他环境可配置绝对 `DATABASE_CA_PATH`。URL 中的 TLS 参数先移除，再应用强验证配置，防止 `pg` 连接字符串覆盖显式 SSL。证书配置错误时应修正信任链，而不是关闭校验。[Heroku PostgreSQL 证书](https://devcenter.heroku.com/articles/connecting-heroku-postgres)、[node-postgres SSL](https://node-postgres.com/features/ssl)
- Heroku 入口只接受精确 `Host` / `Origin`，保留 Secure、HttpOnly、SameSite=Strict cookie 与 no-store。Heroku 模式用 `X-Forwarded-Proto: https` 作传输提示，转发头不提供账户身份、可信 Host 或绕过 CSRF 的权限。不把此公开监听入口直接搬到不受控裸机；自建使用 loopback + 已审查的代理。[Heroku 路由](https://devcenter.heroku.com/articles/http-routing)
- E2EE 不能阻止控制网页代码的一方未来替换 JavaScript，也不能让已复制的旧密文或已泄漏明文消失。弱加密密码仍存在离线猜测风险；访客草稿和普通 JSON/CSV/PDF 导出仍为明文。同源其他页面脚本属于浏览器加密的信任范围。见 [版本与加密边界](editions-and-encryption.md)。

事务始终使用同一个连接，锁在 commit/rollback 时释放。[node-postgres 事务](https://node-postgres.com/features/transactions)、[PostgreSQL 行锁](https://www.postgresql.org/docs/current/explicit-locking.html)

## 当前自定义域名

`https://treeezh.com/drug/` 已可用，`CLOUD_ORIGIN=https://treeezh.com` 已配置。旧默认域名不是第二个可信来源，403 符合预期，cookie 也不会跨域转移。如果以后更换域名，仍须按 Heroku 的 DNS target 配置、核实 HTTPS 并明确调整唯一可信 Origin。[自定义域名](https://devcenter.heroku.com/articles/custom-domains)、[自动证书](https://devcenter.heroku.com/articles/automated-certificate-management)

DNS 只分配主机，不能把 `/drug` 单独指向 Heroku。若根路径以后有独立个人网站，需要同一可信 HTTP 入口按路径分发；当前根路径行为是跳转到药物应用。

## 历史基线与本轮验证

- 历史适配基线：原 SQLite cloud API/vault store 22 项通过；临时 PostgreSQL 18.6/config 11 项通过，涵盖并发初始化、共享会话、CAS、客户端加密往返和注销锁竞争。
- 上一轮双密码安全回归：cloud API 25 项、vault-store 8 项、local-session 1 项、临时 PostgreSQL/config 18 项通过；这些是历史基线，不能冒充新版 OPAQUE 验收。新版已执行 SQLite/API/旧兼容组合 41/41、真实 PostgreSQL/OPAQUE/config 25/25、独立 v3 envelope 9/9，另增加 CLI 禁用测试 1/1。TypeScript 和完整套件由最终 Verify 复核。计数重叠，不应相加。[详细审查记录](security-review-server-2026-09-13.md)
- 冻结 lockfile 安装、类型检查及 `/drug/` cloud 构建曾通过；本轮依赖和界面更改仍由最终 Verify 重新检查。云构建可用 `DRUG_BUILD_OUT_DIR` 指向绝对临时目录，本机 `dist` 不受影响。

本轮云 schema 升至 3：保留账号和密文、增加 OPAQUE 认证字段和 setup/挑战表；来自更旧版本时还包含之前的 PG 配额 schema 1→2 迁移。发布应统一更新 worker，不能长期混跑依赖旧 global 表或旧认证模式的进程。测试验证了新版本并发启动，没有证明混合新旧版本的零停机迁移。

PostgreSQL 测试默认跳过，只有显式配置数值 loopback 的 `DRUG_TEST_POSTGRES_URL` 才执行；测试创建随机独立数据库并在结束后删除，拒绝远程生产地址。本轮 Verify 已配置 PostgreSQL 18 service，首次 CI 必须确认该套检查没有跳过。开发者可针对自己启动的临时 cluster 运行：

```sh
DRUG_TEST_POSTGRES_URL=postgres://drug_test@127.0.0.1:55432/postgres \
  node --import tsx --test tests/heroku-config.test.mjs tests/cloud-postgres.test.mjs tests/cloud-postgres-opaque.test.mjs
```

上述端口和测试用户由临时 cluster 配置决定，不是生产连接字符串，也不表示当前正在运行该服务。
