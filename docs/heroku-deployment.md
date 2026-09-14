# Heroku 部署准备

核对日期：2026-09-13。代码已适配；本说明不表示已经上线或开通了付费数据库。账户 `drug-tracker` 与其默认网址由用户提供。首次使用全新的 PostgreSQL 库，不迁移旧 SQLite 记录。

## 运行方式和费用

本机 `pnpm dev / build / start` 继续使用本机版；自建服务器的 `server/cloud.mjs` 继续使用独立 SQLite 云库。Heroku 的 `Procfile` 单独运行 `server/heroku.mjs`：Node 24、平台提供的 `PORT`、监听 `0.0.0.0`，仅 PostgreSQL，不会在数据库未配置时退回 SQLite。Dyno 磁盘随重启和部署丢失，不能保存正式数据库。[Heroku 文件系统说明](https://devcenter.heroku.com/articles/how-heroku-works)

建议首次使用 **一个 Basic web dyno + Essential-0 PostgreSQL**：当前标价约 **$7 + $5 = $12/月**，未扣学生额度、未计税和额外资源。Eco 为 $5/月但闲置 30 分钟休眠，适合接受首次打开等待的试用。不要启用自动扩容、Review Apps 或额外收费附件。最终账单以用户在 Heroku 的确认页为准。[Dyno 价格](https://www.heroku.com/pricing/)、[PostgreSQL 价格](https://elements.heroku.com/addons/heroku-postgresql)

Essential-0 有 1 GB 存储与 20 个连接。每个进程默认连接池上限 4；扩容时必须把新旧 dyno、维护连接都计入，不能把连接池上限误当整个账户限制。它不适合把此个人实验包装成临床服务。[Essential 规格与限制](https://devcenter.heroku.com/articles/heroku-postgres-plans)

## Dashboard 的实际步骤

1. 进入已有 app **drug-tracker → Deploy → GitHub**，由用户本人完成 GitHub 授权，连接 **Treeezheng/drug-tracker**。选择 `main`。先保留手动部署；连接仓库不会替代一次成功的构建和上线验证。
2. 在 **Resources** 检查需要的 web dyno 和 PostgreSQL。**数据库会收费，由用户本人确认开通**。如果已有正确数据库，不再创建第二个。附加 PostgreSQL 后应自动出现 `DATABASE_URL`，不要把其内容发到聊天、提交到 GitHub 或写入部署日志。
3. 在 **Settings → Config Vars** 设置 `CLOUD_ORIGIN` 为下面完整值，末尾没有斜线，也没有 `/drug`：

   ```text
   https://drug-tracker-7e9d0c2e62c1.herokuapp.com
   ```

   `DATABASE_POOL_SIZE` 可设 `4`。默认 CA 路径已在入口设置，通常无需再填。其他值见 [heroku.env.example](../deploy/heroku.env.example)。不设置 `PORT`、`DYNO`、本机 SQLite 路径、开发 HTTP 开关或任何加密密码。
4. 等包含本次适配的提交已在 `main`，再在 **Manual deploy → main → Deploy Branch** 部署。官方 Node buildpack 从 `package.json` 和唯一的 `pnpm-lock.yaml` 识别项目；Node 固定 `24.x`，pnpm 固定版本。`heroku-postbuild` 执行独立云端构建，强制 `/drug/` 和 cloud edition，构建中不连接数据库。Cloud Native buildpack 的 `heroku-build` 只输出提示，实际编译也统一在 `heroku-postbuild` 完成，避免先跑本机构建。`Procfile` 指定 web 命令，因此不会误用本机 `start`。[GitHub 集成](https://devcenter.heroku.com/articles/github-integration)、[Node 支持](https://devcenter.heroku.com/articles/nodejs-support)、[Classic 构建脚本](https://devcenter.heroku.com/articles/nodejs-classic-buildpack-builds)、[Cloud Native 构建顺序](https://devcenter.heroku.com/articles/nodejs-cloud-native-buildpack-builds)
5. 在 **Activity** 查看构建结果，在 **Resources** 确认 web dyno 已启动。启动时以 PostgreSQL 事务和 advisory lock 初始化专属 `drug_tracker` schema；空库可直接在网页注册，不需要预置管理员密码或把加密密码放进 Config Vars。
6. 访问 **[实际应用地址](https://drug-tracker-7e9d0c2e62c1.herokuapp.com/drug/)**。Heroku 的 `Open app` 只打开根地址时，手动在地址末尾加 `/drug/`。API 版本检查是 `/drug/api/edition`，应返回 `{"edition":"cloud"}`；本机 `/api/*` 在云端不存在。

当前仓库没有启用 CI；不能声称自动部署正在等待已配置的测试。首次部署验证后，才考虑启用自动部署并添加真实 CI。

## 上线验收

使用合成记录完成：游客模拟与刷新保留；注册和重新登录；设置与账户密码不同的加密密码；保存记录后刷新并重新解锁；两个标签页的并发保存冲突；锁定与注销；错误加密密码被拒绝。重启 dyno 后，账户和密文应保留。浏览器 Network 的 vault 请求只能出现版本化密文与包裹密钥，不应出现药名、剂量、笔记、加密密码或恢复密钥。

生产域名的 HTTPS、实际 PostgreSQL CA 链、Heroku GitHub 构建和重启验收，必须在真实部署后再确认。本地测试不能替代这些检查。应用日志不打印请求正文、凭据、密文或异常堆栈；Heroku router 仍会记录 URL、状态、时间和网络元数据，因此不要把秘密放入 URL。[Heroku 路由与日志](https://devcenter.heroku.com/articles/http-routing)

## 数据和安全边界

- PostgreSQL 保存账户名、显示名、scrypt 账户密码哈希、会话令牌哈希、到期时间及密文元数据；健康记录仅为浏览器产生的 `dataEnvelope`，随机 vault key 仅以 `keyEnvelope` 包裹后保存。服务端没有解密 API，也不接收加密密码或恢复密钥。
- 注册、登录与会话创建在同一事务；会话在所有实例共享。保存事务先验证并锁定会话，再锁定 owner 行，即使首次创建也只有一个预期 revision 能成功。数据与包裹密钥整体更新。注销会等待已经开始的写入；注销完成后旧会话不能继续写入。过期会话清理不与账户锁交叉持有。
- 登录与注册分别使用数据库中的全局固定窗口限额，跨 dyno 共享，忽略可伪造的转发 IP。大量尝试也会影响其他用户，这是当前小型个人服务的可用性限制；每进程另限制同时执行密码哈希的数量。
- 数据库 TLS 最低 1.2，验证证书与主机名，**不使用 `rejectUnauthorized:false`**。Essential 数据库当前使用 RDS 证书；Heroku buildpack 镜像包含 CA bundle `/usr/lib/ssl/certs/ca-certificates.crt`。其他环境可配置绝对 `DATABASE_CA_PATH`。URL 中的 TLS 参数会被移除，然后统一应用强验证配置，防止 `pg` 的连接字符串覆盖显式 SSL 对象。证书配置不正确时应修正信任链，不关闭校验。[Heroku PostgreSQL 证书](https://devcenter.heroku.com/articles/connecting-heroku-postgres)、[node-postgres SSL](https://node-postgres.com/features/ssl)
- Heroku 入口只接受精确 `Host` / `Origin`，保留 Secure、HttpOnly、SameSite=Strict cookie 与 no-store。只在 Heroku 专用入口使用 `X-Forwarded-Proto: https` 作为传输提示；转发头不提供账户身份、可信 Host 或绕过 CSRF 的权限。Heroku 官方提醒转发头不能作为可信身份依据。不要把此公开监听入口直接搬到不受控裸机；自建仍用 loopback + Caddy。[Heroku 路由](https://devcenter.heroku.com/articles/http-routing)
- E2EE 不等于运营者绝对无法攻击：弱加密密码可离线猜测，控制网页代码的一方可在未来替换 JavaScript。访客草稿仍为浏览器明文，用户导出的普通 JSON/CSV/PDF 仍是明文。数据库中没有明文健康记录与“运营者永远不能解密”不是同一个承诺。见 [版本与加密边界](editions-and-encryption.md)。

事务必须使用同一个连接，锁在 commit/rollback 时释放。本实现遵循 [node-postgres 事务文档](https://node-postgres.com/features/transactions) 与 [PostgreSQL 行锁说明](https://www.postgresql.org/docs/current/explicit-locking.html)。

## 以后使用 treeezh.com/drug

目标仍是 `https://treeezh.com/drug/`。先验证 Heroku 默认网址，再添加自定义域名、按 Heroku 提供的 DNS target 设置记录并核实 HTTPS，最后把 `CLOUD_ORIGIN` 切换为 `https://treeezh.com`。切换后旧默认域名不会被当作第二个可信来源，原 cookie 也不会跨域转移。[自定义域名](https://devcenter.heroku.com/articles/custom-domains)、[自动证书](https://devcenter.heroku.com/articles/automated-certificate-management)

DNS 只分配主机，不能把 `/drug` 单独指向 Heroku。如果 `treeezh.com/` 以后有独立个人网站，需要同一可信 HTTP 入口按路径分发；当前程序没有伪造那个个人网站，也不会自动替换它。同源其他页面的脚本也是浏览器加密的信任边界。

## 已完成的本地验证

- 原 SQLite cloud API 与 vault store：22 项通过，包含旧库迁移、不误读本机库、CSRF、注册、会话、密文与 CAS。
- PostgreSQL 18.6 临时独立 cluster：11 项通过（含配置测试及子测试），覆盖并发初始化、重复用户名、共享会话、两次 CAS 竞争、真实客户端加密往返、注销与保存行锁竞争、跨实例限额和两个 HTTP 服务实例。
- pnpm 冻结 lockfile 安装、TypeScript 检查及独立 `/drug/` cloud 构建成功；未引入第二个 lockfile。云构建输出可用 `DRUG_BUILD_OUT_DIR` 指向新的绝对临时目录，本机 `dist` 不受影响。

PostgreSQL 集成测试默认跳过，只有明确设置本机数值 loopback 的 `DRUG_TEST_POSTGRES_URL` 才运行。测试创建随机命名的独立数据库并在结束后删除，不连接远程生产数据库；正式 CI 尚未配置这项环境。开发者可对一个自己启动的临时 cluster 运行：

```sh
DRUG_TEST_POSTGRES_URL=postgres://drug_test@127.0.0.1:55432/postgres \
  node --import tsx --test tests/heroku-config.test.mjs tests/cloud-postgres.test.mjs
```

端口、测试用户由该临时 cluster 的启动配置决定，上例不是已运行服务，也不是生产连接字符串。
