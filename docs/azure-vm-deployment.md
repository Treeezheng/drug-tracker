# 自有 Azure VM 部署：treeezh.com/drug

核对日期：2026-09-13。本文是部署准备与操作指南，**没有创建 VM、修改 DNS 或发布服务**。Azure for Students 注册和可用规格仍等待用户完成；没有启用 GitHub Actions / CI。先完成 [云版验收](./editions-and-encryption.md)，再按此流程部署。账户申请与价格依据见 [学生优惠计划](./cloud-and-student-plan.md)。

## 已确定的运行契约

```text
浏览器 https://treeezh.com/drug/
  → Caddy HTTPS :443
  → 127.0.0.1:4312/drug/（server/cloud.mjs）
  → /var/lib/drug-tracker/cloud.sqlite
```

云 API 是 `/drug/api`，Vite base 是 `/drug/`，浏览器 Origin 是 `https://treeezh.com`。Node 已处理完整前缀，Caddy **必须保留 `/drug`**。`handle_path` 会剥掉前缀，因此这里采用 `handle`。原始 Host / Origin 也应保留，不能伪造成 localhost 来绕过来源校验。[Caddy handle](https://caddyserver.com/docs/caddyfile/directives/handle)、[reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

只有云入口 `server/cloud.mjs` 用于这次部署。`pnpm start` 仍启动本机版 `server/index.mjs`，不可用于公网。云入口只绑定 `127.0.0.1`，使用单独数据库、公开注册的独立账户、Secure cookie 和精确来源校验；拒绝本机版数据库及未标记为 cloud 的静态构建。以下自管 VM 是一种部署选项，不代表已创建资源。

`/drug` 不能隔离同源其他页面的脚本、存储或 Service Worker 权限。因此 `treeezh.com` 根网站也必须可信，不能托管不可信用户脚本。模板没有填入个人网站内容：新站根路径返回 404；若已有个人网站，只合并药物应用路由，保留原有根站配置。

## 1. 用户完成账户与资源选择

1. 从 [Azure for Students](https://azure.microsoft.com/en-us/free/students/) 注册，自己完成教育身份、账户安全与必要的账户验证。门户订阅名称应为 Azure for Students；确认赠金和到期日。
2. 门户搜索 **Virtual machines → Create → Azure virtual machine**；独立资源组可命名 `drug-tracker`。选择账户实际提供的 Ubuntu Server 24.04 LTS、x64 架构和小型通用 VM。以账户当前可选规格和总价为准，不照抄门户示例的较大默认机型。官方创建流程包括订阅、资源组、镜像、规格、SSH key 和最后的价格确认。[Azure Linux VM 门户指南](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/quick-create-portal)
3. 首次可评估 1–2 GB 内存；前端在另一构建目录 / Mac 构建，VM 只运行服务。16 MB vault 上限与两个并发密码验证的内存峰值仍需实测，不保证最小 VM 在所有边界都足够。系统盘、公网 IPv4、备份和出站流量分别核对，不把所有资源视为免费。
4. 使用 SSH 公钥，私钥由用户保管。NSG 入站规则只放行自己的管理 IP 到 TCP 22，以及公网 TCP 80 / 443；不要放行 4310、4312 或 5173。SSH 来源变化时先更新规则再连接。[NSG 来源与端口规则](https://learn.microsoft.com/en-us/azure/virtual-network/manage-network-security-group)
5. 在创建确认页检查全部费用后，由用户完成购买 / 创建。记录实际公网 IP，确认预算提醒与赠金到期处理。关闭 VM 不保证磁盘和 IP 停止计费。

## 2. 安装 Node 24 与 Caddy

以下命令在新 Ubuntu VM 的 SSH 终端执行，**不是本机 Mac 启动步骤**。

```sh
sudo apt update
sudo apt install ca-certificates curl xz-utils sqlite3
```

从 [Node 官方下载](https://nodejs.org/en/download) 选择 Node **24 LTS、Linux x64**。本次核对官方版本为 24.21.0；部署时选择已核验的 24.x 安全版本，并按官方 [签名校验说明](https://github.com/nodejs/node#verifying-binaries) 核对签名及 SHA-256。不要把 Mac 二进制复制到 Linux。下载并校验对应归档后，例如：

```sh
sudo install -d -m 0755 /opt/node24
sudo tar --extract --xz --file node-v24.21.0-linux-x64.tar.xz --directory /opt/node24 --strip-components=1 --no-same-owner
sudo chown -R root:root /opt/node24
/opt/node24/bin/node --version
```

如果 VM 最终使用 ARM，需改选 Linux arm64 官方归档；不能用上述 x64 文件。服务单位固定 `/opt/node24/bin/node`，不依赖交互终端的 nvm 或 PATH。

按 [Caddy 官方 Ubuntu 安装步骤](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) 使用 stable 软件仓库安装。官方包会创建并启动 `caddy` systemd 服务；先检查 `/etc/caddy/Caddyfile`，不要覆盖已有站点。Ubuntu 自动安全更新的默认来源不保证包含第三方 Caddy 仓库，需另行检查 Node / Caddy 更新。[Ubuntu 自动更新](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)

## 3. 创建服务用户和独立数据目录

```sh
sudo adduser --system --group --no-create-home drug-tracker
sudo install -d -m 0755 /opt/drug-tracker/releases
sudo install -d -m 0700 -o drug-tracker -g drug-tracker /var/lib/drug-tracker
sudo install -d -m 0750 -o root -g drug-tracker /etc/drug-tracker
```

代码和 Node 二进制属于 root，运行账户只能读代码；数据库目录属于 `drug-tracker`，目录权限 0700，数据库由服务创建为 0600。SQLite 的 WAL / SHM 需要同目录可写。不要上传 Mac 的 `data/`、本机 SQLite、WAL、浏览器缓存或明文备份。

## 4. 构建并安装审核过的版本

在独立检出的源代码目录构建，不覆盖日常 Mac 本机版的 `dist`。选择实际审核过的 Git commit，记录 `git rev-parse HEAD`。依赖使用仓库锁文件；不要复制 Mac `node_modules` 到 Linux。

```sh
pnpm install --frozen-lockfile
pnpm test
DRUG_EDITION=cloud DRUG_BASE_PATH=/drug/ pnpm build
```

确认 `dist/index.html` 有且只有一个 `<meta name="drug-edition" content="cloud">`，资源路径以 `/drug/` 开头。该环境变量只在构建时决定入口，不能在运行时把本机产物变成云版。生产服务不运行 Vite dev server；现有 dev proxy 仍用于本机 4310。

将经过审核的完整应用源文件、`dist/`、`server/`、`src/lib/password-policy.mjs`、`package.json`、`pnpm-lock.yaml` 和 `deploy/` 放入一个**新建的**版本目录，例如 `/opt/drug-tracker/releases/20260913-<实际短commit>/`，然后设置 `/opt/drug-tracker/current` 指向它。路径里的示例短 commit 必须替换为实际值。首次部署才创建 `current`；更新时在旧版本和备份可恢复后再切换。

当前服务使用锁定版本的 OPAQUE、PostgreSQL 和本地密码策略运行依赖；必须保留 `package.json`/`pnpm-lock.yaml`，在发布目录用 `pnpm install --prod --frozen-lockfile` 安装生产依赖。不能只复制入口和 vault-store，也不能省略其余服务模块。发布包不包括本机数据库、环境秘密、私人备份或测试产物。不要对整个服务器目录运行宽泛的覆盖或删除命令。

在实际版本目录下安装这两个配置文件：

```sh
sudo install -m 0600 -o root -g root deploy/.env.example /etc/drug-tracker/cloud.env
sudo install -m 0644 -o root -g root deploy/drug-tracker.service /etc/systemd/system/drug-tracker.service
```

`cloud.env` 有五个非秘密参数：数据库绝对路径、HTTPS origin、4312 端口、静态目录和 `CLOUD_PROXY_MODE=caddy-loopback`。该代理模式要求 Caddy 是同机公开入口，并由模板覆写 `X-Drug-Client-IP`；不能直接信任外部请求提交的来源头。账户密码、完整恢复码和数据密钥都不能写入这里。`CLOUD_ALLOW_INSECURE_LOOPBACK` 在 HTTPS 部署中保持未设置。

## 5. 通过安全网页注册

空云数据库可直接启动；完成 HTTPS 验证后，在网页创建单密码 OPAQUE 账户。CLI bootstrap 已禁用，不能用 `CLOUD_ADMIN_PASSWORD` 创建新账户；常驻服务若发现该密码环境变量会拒绝启动。服务不会接收新账户的原始密码、客户端 export key 或数据密钥。

OPAQUE 服务 setup 会在共享数据库中原子创建一次并持久保留；不需要把它手工放入环境变量，也不可在重启时重新生成。必须备份整库，包含 setup、OPAQUE 密码文件、恢复验证摘要和密文。数据库连同 setup 被盗仍存在离线猜密码风险；它不是独立于数据库的秘密边界。

用户离线保存完整恢复码。恢复流程只将独立的账户验证部分交给服务器，解密部分不上传；最终恢复原子更换密码文件、数据密钥、密文和恢复验证摘要并撤销旧会话。不要删除数据库或新建 owner 来“恢复”旧记录。详细请求与失败语义见 [单密码协议](opaque-protocol-v1.md)。

## 6. 验证内部服务，再配置 HTTPS

```sh
sudo systemd-analyze verify /etc/systemd/system/drug-tracker.service
sudo systemctl daemon-reload
sudo systemctl enable --now drug-tracker
sudo systemctl status drug-tracker --no-pager
curl --fail --silent --show-error -H 'Host: treeezh.com' http://127.0.0.1:4312/drug/api/edition
sudo ss -ltnp
```

健康响应必须是 `{"edition":"cloud"}`。`ss` 应显示 Node 仅在 `127.0.0.1:4312`，不能是 `0.0.0.0` 或公网地址。直接使用 localhost Host 会被有意拒绝，健康检查使用配置的 `treeezh.com` Host；生产代理也保留真实 Host。服务单位用 `StateDirectory`、只读系统文件视图、独立用户和限定写入目录，依据 Ubuntu 24.04 的 systemd 语义配置。[Ubuntu systemd.exec 手册](https://manpages.ubuntu.com/manpages/noble/man5/systemd.exec.5.html)

**DNS 由用户实际批准后操作：** 在域名当前 DNS 提供商添加 / 更新 `treeezh.com` 的根 A 记录，指向已确认的 VM 公网 IPv4；没有可用 IPv6 时不要添加 AAAA。如果根域已经指向个人网站，不直接改掉它：先确认是否迁入同一台服务器或保留现有反向代理。DNS 只决定域名地址，`/drug` 由 Caddy 路由。

新站可用 `deploy/Caddyfile` 为模板；已有 `treeezh.com` site block 只合并 `@drug` 和对应 `handle`，保留其余路由。检查合并后的完整配置，再运行：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl --fail --silent --show-error https://treeezh.com/drug/api/edition
```

Caddy 根据真实域名自动申请和续期证书，需要 DNS 正确、证书验证所需端口可达和持久化证书存储。保留官方 systemd 服务的数据目录，不把它放入临时发布目录。[Caddy 自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[官方服务运行方式](https://caddyserver.com/docs/running#using-the-service)

如果开启 Ubuntu UFW，先放行当前管理来源的 SSH，再放行 TCP 80 / 443，确认规则后启用。保持第二个 SSH 会话可用，防止误锁自己；NSG 和 UFW 两层都需要允许实际流量。[Ubuntu UFW 指南](https://documentation.ubuntu.com/server/how-to/security/firewalls/index.html)

## 7. 上线验收与恢复

使用独立合成记录验证：`/drug` 跳转 `/drug/`；根网站保留原行为；资源、字体、Privacy、API 均处于正确路径；访客无需账号即可演算，公开注册创建独立账号且不上传访客草稿；跨源写入失败；cookie 具有 Secure / HttpOnly / SameSite=Strict / Path=/drug/。Mac 和 iPhone Safari 分别验证单密码注册与登录、恢复码恢复、密码更换、恢复码轮换、保存、刷新、并发冲突、断网重试、退出及重新打开。至少两个合成账户分别验证读取、保存及跨标签页账号切换不会混用另一账户的 vault。

当前登录账户采用在线保存、内存解密，不持久化账户明文缓存；关闭页面可能丢弃尚未确认的编辑。独立访客演算有明文 localStorage，必须明确显示并支持 Clear simulation；不得把访客模式描述为加密。当前 vault / JSON 备份是现存记录快照，不保留以前的纠正版本或已删除历史；CSV / JSON 下载均为用户主动生成的明文。使用与访客不同的合成药名 / 笔记，检查网络、数据库、WAL 和浏览器存储不得出现账户健康明文、原始密码、完整恢复码或数据密钥，不能仅以算法测试通过作为完整链路验收。

备份需要完整云 SQLite（包括 OPAQUE setup、同一 owner 的账户密码文件、恢复验证摘要、包装密钥、密文和版本），同时由用户在服务器之外保存客户端恢复密钥。可用 SQLite `.backup` 创建一致性快照，不能只复制正在写入的主文件而忽略 WAL；先在临时路径验证恢复，不覆盖唯一原库。[SQLite CLI 备份](https://sqlite.org/cli.html#special_commands_to_sqlite3_dot_commands_)

```sh
sudo install -d -m 0700 -o drug-tracker -g drug-tracker /var/backups/drug-tracker
# 将日期替换为本次唯一的备份名；先确认该目标不存在。
sudo -u drug-tracker sqlite3 /var/lib/drug-tracker/cloud.sqlite ".backup '/var/backups/drug-tracker/cloud-20260913.sqlite'"
sudo chmod 0600 /var/backups/drug-tracker/cloud-20260913.sqlite
```

此数据库快照仍含 OPAQUE setup、密码文件、恢复验证摘要与会话元数据，需要私密保管。恢复必须保留原账户 owner ID 和 setup；新建账户不会自动获得原密文。代码回退不等于数据库格式回退，更新前保留审核版本、当前数据库快照与可验证的恢复流程。Azure 机器快照不能替代应用恢复演练。

本轮对部署模板做了代码契约和静态审查；当前 Mac 没有 Caddy / systemd，**尚未运行这两个工具的真实校验，也未做 Azure VM 或真实域名 HTTPS 联调**。以上检查命令是部署时必须完成的步骤，不是已通过的测试报告。
