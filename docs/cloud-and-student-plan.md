# Drug Tracker：自有服务器与 Berkeley 学生优惠

核查日期：**2026 年 9 月 13 日**。本轮检查官方价格、学校及优惠条款，并检查现有代码。没有申请账户、购买服务器、配置 DNS 或上传记录。价格为税前，地区、库存和结账条件仍须在创建资源时确认。

## 当前决定

**目标是自己管理一台 Linux VPS，浏览器负责端到端加密，服务器只同步密文。** 这覆盖早期以 Supabase 为默认方案的建议。React / Vite、Node / SQLite 可以继续使用，不需要 Kubernetes 或独立托管数据库。用户已购买 **treeezh.com**，正式目标地址确定为 **https://treeezh.com/drug**；云账户尚未建立，先申请学生优惠。域名注册和云服务器是两件事。

**先申请 Azure for Students。DigitalOcean 的 GitHub 学生优惠已经结束，不再引导用户按旧教程兑换 $200。** GitHub Education Partnerships 的 Morgan Ersery 于 2026 年 7 月 7 日在官方社区置顶说明：最后兑换日为 7 月 31 日，剩余额度 8 月 1 日失效。当前 Pack 目录也已无 DigitalOcean，旧学生入口重定向首页。[GitHub 教育合作公告](https://github.com/orgs/community/discussions/201240)、[公告作者身份](https://github.com/morganersery1)、[当前 Pack](https://education.github.com/pack)、[原 DO 入口](https://www.digitalocean.com/github-students)

**当前成品仍是本机版，尚未具备完整 E2EE，也尚不能直接公开到互联网。** 本机密码是访问控制；SQLite、修改历史、浏览器缓存和 JSON 备份仍有明文。密钥模块的开发不等于全部存储、同步和恢复已加密。完整边界见 [版本与加密说明](./editions-and-encryption.md)。

## 现在实际可以办理的学生申请

### 1. Azure for Students：本次首选

官方目前提供 **$100，12 个月内使用，注册无需信用卡**。资格：18 岁以上、认可的两年或四年制学校全日制学生、通过学校身份验证；每人一份，受供应和条款限制。额度耗尽会停用；升级按量付费是另一项决定。[Azure 学生优惠条款](https://azure.microsoft.com/en-us/pricing/offers/ms-azr-0170p/)

用户操作：

1. 打开 [Azure for Students](https://azure.microsoft.com/en-us/free/students/)，点 **Start free**，用自己的 Microsoft 账户登录。
2. 按页面验证学校邮箱和学籍；选择 / 填写 University of California, Berkeley。账户密码、验证码、学生材料和任何计费确认由用户本人处理，不发送到项目或聊天记录。
3. 进入 Azure Portal 的 **Subscriptions**，确认订阅名称 / 类型为 **Azure for Students**，并查看教育额度余额和到期日；保持支出限制。
4. 将“订阅已获批、可用地区、额度到期日”告知实施者即可，不需要提供密码、恢复码、证件或支付信息。

获批后再建独立资源组 `drug-tracker-lab`，使用一台 Linux VM 验证同一套 VPS 架构。先查看账户里可用的免费规格：官方当前列出新客户前 12 个月每月 750 小时的 B1s / B2pts v2 / B2ats v2 对应额度；可从 B1s x64 开始核对。公网 IP、磁盘、备份可能另计，必须看创建确认页；不能只因 VM 计算免费就说整个网站免费。[Azure 免费服务与续期说明](https://azure.microsoft.com/en-us/free/students/)

在 Cost Management 设置预算提醒，首日和首个账期检查实际费用。学生身份可每年重新验证，不意味着所有“新客户前 12 个月”服务每年重置。实验结束时检查并删除不用的 VM、磁盘、快照、IP；预算提醒不是硬性停费开关。

### 2. GitHub Education：仍值得认证

1. 使用长期持有的个人 GitHub 账户，开启两步验证，并添加、验证 Berkeley 学校邮箱；申请要求学校邮箱时必须先验证。
2. 进入 **Settings → Education benefits → Start an application**。学校填写 University of California, Berkeley，提交当前学生身份证明。资格包括年满 13 岁、在读学位或文凭课程。
3. 需要证明时进入 **CalCentral → My Academics → Academic Records → Enrollment Verification**，下载当前学期在读证明；此自助服务免费。
4. 获批后到自己的 [Education portal](https://github.com/education) 查看可兑换权益。学生认证和伙伴优惠兑换是两个步骤；认证不代表所有额度自动到账。

依据 [GitHub 官方申请流程](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student) 与 [Berkeley 在读证明步骤](https://www.registrar.berkeley.edu/academic-records/education-degree-verification/verify-attendance-and-degrees/)。本项目已有域名，无需为了首年域名优惠再买一个。Azure 不需要等 GitHub Education 获批才从自己的官方入口申请。

Berkeley 明确说明，这些个人云账户不由学校管理或背书，学生负责账户、安全与费用。学校网页中的促销概述不能代替厂商最新条款。[Berkeley Student Technology Services](https://studenttech.berkeley.edu/it-services-resources-and-policies/cloud-computing-services-students)

## 优惠结束后的低成本选择

若学生申请不可用或准备长期托管，**最容易估算的起点是 DigitalOcean Basic / Regular 1 GiB，$6/月；加基础周备份为 $7.20/月**。现金支出更低的备选是 Google 免费 e2-micro 加收费公网 IPv4，约 $3.65/月起，但配置和账单边界更细。都可以运行同一套自托管应用。

假设个人使用、纯文字记录、一个实例、无高可用，税、超额流量及异地备份另计。这里比较已核实的若干实用方案，不宣称全球最低价。

| 方案 | 已核实价格 / 额度 | 取舍 |
|---|---|---|
| DigitalOcean Basic Regular 1 GiB | 1 vCPU、25 GiB SSD、1,000 GiB 流量，$6/月 | 周备份加 20%，合计 $7.20；日备份加 30%，合计 $7.80 |
| Google e2-micro Free Tier | 指定美国地区计算 + 30 GB 标准持久磁盘免费；公网 IPv4 约 $3.65/月 | 配置限制较多；备份、超额出站另计 |
| OVHcloud US VPS-1 | 页面 **$4.54/月起**，2 vCore、4 GB、40 GB NVMe、IPv4、最近一天备份 | 未能核实结账页月付 / 承诺期 / 续费价；“起价”不是无条件月付承诺 |
| Hetzner CX23，欧洲 | 新价 $6.49/月，不含 IPv4 / 备份 | 对加州用户不比上面更直接；美国 CPX11 新价 $20.49/月，不含 IPv4 |
| Azure for Students | $100 / 12 个月及符合资格的免费量 | 本次先申请；到期前再决定长期服务器 |
| Oracle Always Free A1 | 当前合计 2 OCPU / 12 GB，符合额度时 $0 | 可能缺容量或因闲置被回收，不建议作为日常记录唯一存放处 |

DigitalOcean 还列有 $4/月、512 MiB 方案；本项目暂不以它作为 Node、系统服务和备份同时运行的起点。1 GiB 也是试运行起点，并非已验证的容量保证；2 GiB 为 $12/月，确有需要再扩容。[Droplet 价格](https://www.digitalocean.com/pricing/droplets)、[备份价格](https://docs.digitalocean.com/products/backups/details/pricing/)

Google 免费计算限非 Spot 的 `e2-micro`，地区 `us-west1`（Oregon）、`us-central1`、`us-east1`，各实例累计小时不能超免费总量；包括 30 GB-month **standard persistent disk** 和每月 1 GB 指定方向出站流量。普通 VM 在用 IPv4 为 $0.005/小时，每账户每月免费 1 小时；以 730 小时估算：`(730 − 1) × $0.005 = $3.645`，约 **$3.65**。不是零账单方案。[免费额度](https://docs.cloud.google.com/free/docs/free-cloud-features)、[IPv4 计费](https://cloud.google.com/vpc/network-pricing)

OVH 默认最近一天备份不等于七天滚动历史；后者是付费选项。页面起价还需在账户结账页核实。[OVHcloud US VPS](https://us.ovhcloud.com/vps/)

Hetzner 2026 年 6 月 15 日对新订单及扩缩容实施新价格，旧教程报价已不适用。[官方调价表](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)

Oracle 当前额度是 2 OCPU / 12 GB，不是旧文章中的 4 OCPU / 24 GB；容量和闲置回收规则使它更适合实验。不要制造无意义负载来规避回收。[当前 Always Free 规则](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## 最小服务器结构与配置

下面是**完整云安全与 E2EE 改造后的计划**，现在不能据此直接公开现有服务。

```text
Mac / iPhone：解密、图表、历史、导出
  └─ HTTPS：https://treeezh.com/drug
      └─ Caddy：证书和反向代理
          └─ Node 24：127.0.0.1:4310，认证与密文同步
              └─ SQLite：密文、版本、最少必要同步元数据
```

Azure 学生 VM 和普通 VPS 均可用这个结构。`/drug` 是应用路径；前端、API 同源，先不增加 CDN、邮件登录、托管数据库或容器编排。域名 DNS 配置到服务器，路径由反向代理处理；DNS 本身不配置 `/drug`。

路径必须全链路一致：构建的 Vite base 为 `/drug/`，前端 API 请求为 `/drug/api/...`，`/drug` 跳转 `/drug/`，Caddy 对这个路径剥掉 `/drug` 后交给内部 Node。配置的浏览器 Origin 仍是 **`https://treeezh.com`**，不含路径。根域其他内容不应被该应用的 SPA fallback 覆盖；同源其他页面也必须可信，因为 IndexedDB / JavaScript 权限不按 `/drug` 隔离。这些均为待实施的部署契约。

若后续选 DigitalOcean：**Create → Droplet → Bundled → Basic / Regular → 1 GiB**，选择靠近加州且该规格可用的 San Francisco 区域，Ubuntu 24.04 LTS x64，数量 1，SSH key，基础周备份。避免误选独立计价的 v5、托管数据库或附加卷；创建前检查总价。[官方创建流程](https://docs.digitalocean.com/products/droplets/how-to/create/)

若选 Google：单独项目与结算账户，Compute Engine、Oregon `us-west1`、非 Spot `e2-micro`、Ubuntu x64、最多 30 GB **standard persistent disk**、一个公网 IPv4；在账单中确认抵扣。默认 balanced disk、额外 VM、Cloud NAT 不应误算成免费。[免费规则](https://docs.cloud.google.com/free/docs/free-cloud-features)

运行采用独立非 root 服务用户，数据目录独立于发布目录，限制为该用户可读写。Node 24 + systemd 足够。前端在 Mac / CI 构建后复制产物；Linux 依赖在 Linux 安装，不能把 Mac 的 `node_modules` 直接复制过去。发布不上传本机 `data/`、WAL 或明文 JSON 备份。

防火墙：SSH 限自己的管理来源；对外仅开放 HTTPS 443 以及证书验证 / 跳转所需 80，**4310 不对外开放**。按主机或标签实际绑定规则。[云防火墙规则示例](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/)

Caddy 同机反代至 `127.0.0.1:4310`，保留真实 Host / Origin。域名 A / AAAA 指向实际可达地址，证书目录持久化；Caddy 自动签发与续期，不需要购买额外 SSL 证书。[自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[代理与转发头](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

**不要删除 Origin、伪造 localhost Host 或允许所有来源来绕过当前 403。** 应增加独立云配置、精确 HTTPS 来源校验、Secure cookie 和受控账户初始化。默认本机模式继续仅 loopback。拟新增环境变量及加密 schema 当前均未集成；本轮未添加可能被误认为“已可安全公开”的 Docker / Caddy 部署文件。

## 上线顺序

1. GitHub 只发布源代码、锁文件、许可证、说明与合成测试；检查忽略列表和待提交内容。开源不等于公开数据库。
2. 完成密钥模块及存储 / 同步 / 历史 / 缓存 / 备份集成，通过篡改、错误密语、恢复和多设备冲突测试。
3. 完成 HTTPS 来源、Secure cookie、CSRF、代理信任、限流和账户初始化；独立测试库验证，不迁入正式库。
4. 在 Mac 与 iPhone Safari 验证解锁、离线、重新连接、冲突、锁定、换机恢复和导出；检查数据库、WAL、网络及 IndexedDB 无健康明文或 vault 密钥。
5. 建立 SQLite 一致性备份与恢复流程；机器快照不能代替恢复验证，直接复制主数据库可能遗漏 WAL 提交。备份加密数据及密钥包装信息，用户另存客户端恢复密钥。
6. 通过后在浏览器内加密迁移真实记录，逐项核对；本机原始数据保留，不自动删除。

当前外部等待是 **Azure 学生账户获批与可用规格确认**；实现阻塞是完整 E2EE 和云安全边界。申请可以先做，购买 / 公网部署不必先于代码验证。

旧 [Azure Retail Prices 快照](./azure-retail-price-snapshot.json) 保留作此前方案的研究记录，不是当前默认架构成本。
