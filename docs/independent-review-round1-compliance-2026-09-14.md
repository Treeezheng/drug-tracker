# 第 1 轮独立审查：隐私、合规与数据含义

审查日期：2026-09-14。角色：独立隐私／合规／数据含义审查。运营者：Treee；联系：uhenrywksp@icloud.com。

## 范围和证据边界

- 本轮直接读取当前源码、PRIVACY.md、public/privacy.html、TERMS.md、public/terms.html、SECURITY.md、README.md、当前事件响应操作文档、部署和第三方声明生成脚本；不以旧 review 的结论为依据。
- 委托提供的基线为 main `f6c01e75c29a24a758c4399f1df114aff7dd4045`，工作分支 `codex/independent-security-review`。本轮未运行 Git 命令，因此此标识是委托提供的版本定位，不声称自行核实提交或工作区洁净状态。下列行号为本轮首次检查时的源码位置，主审查者并行修复后可能移动。
- 已知运营事实由委托提供：Heroku Basic web dyno + Postgres Essential 0；每天 America/Los_Angeles 02:00 备份；两份手动备份；没有恢复演练。本轮没有读取 Heroku 账户、数据库、备份内容、生产健康记录或用户凭据。
- 只读生产验证：2026-09-14 07:31:45 UTC 对 `https://treeezh.com/drug/` 发出一次无 Cookie 的 HEAD 请求，得到 HTTP 200 及公开响应头。未做生产攻击测试。
- 未改产品代码、政策或部署配置；本轮唯一写入是本报告。测试仅使用合成数据和临时目录。

本范围确认 **2 项 P2 文案／实现不一致**，另有 **1 项 P3 发布防漂移缺口**。没有在已检查路径发现健康明文上传广告／分析服务、完整恢复密钥上传、主动账户数据持久缓存或当前第三方声明缺失。这个结论不等于没有其他缺陷、专业安全审计、临床验证或法律认证。

## 确认问题和建议

### C1 · P2 · 方法说明否认实际显示的尾部估计，并错误概括其他强度

**位置：** `src/App.tsx:235`；`src/lib/model-formula.ts:46-51`。行为依据：`src/lib/model.ts:100-108,119-144`；`src/lib/timeline-estimates.ts:17-28`；`src/components/GuestSimulator.tsx:49`。现有测试 `tests/model-formula.test.ts:26-36` 只检查 publishedOnly=true 的边界，甚至要求说明不得提到 tail，因而固化了旧说明。

**确认事实：** Settings → Sources & methods 说 Concerta 18 mg 在 29.976 h 后没有 contribution data；同处说其他强度／产品使用 dimensionless assumptions。直接 Concerta Formula 也只描述插值并说该时点后没有数据。当前默认显示会在这以后计算并显示半衰期 3.5 h 的估计尾部；部分目录强度则显示 ng/mL 参考比例缩放，并非仅有无量纲假设。README.md:57-63 已描述新行为，因此用户从不同说明入口会获得相互矛盾的解释。

**合成复现：** 一次 Concerta 18 mg，在给药后 32 h，`concentration(..., false)` 返回 `value=0.04889241777503329`、`tail=true`、`evidence=B`，同时 `describeDoseFormula()` 返回 “Published profile · A” 和 “No data beyond 29.976 h.”。Concerta 36 mg 在 2 h 的 displayed estimate 为 `4.182463035019456 ng/mL`、`hasReference=true`、`directComplete=false`。

**影响：** 公式说明是用户判断数字来源的直接依据，不能只描述一段有观测支持的范围却省略正在展示的外推，也不能把仍显示物理单位的参考缩放统称为无量纲假设。星号和医学免责声明降低误解风险，但不修复此矛盾。这里确认的是说明错误，不是在本轮认证该药代模型。

**建议替换文本：**

> Concerta 18 mg uses an adult group reference trace through 29.976 h. The displayed continuation after that point uses an estimated 3.5 h half-life and is marked with a star; it is not observed data. Ritalin IR 10 mg uses a constructed reference estimate with an amplitude of 4.3 ng/mL, a peak at 2 h and a cross-study 3.5 h half-life. Neither curve measures or predicts your personal drug concentration.

> Eligible catalog strengths of methylphenidate IR and Concerta may show a starred, proportionally scaled reference estimate. This scaling is unvalidated. Custom packages and unsupported products do not gain a concentration curve. Previously saved illustrations use relative units and remain unvalidated. Only compatible analytes and units are added; unknown contributions remain unknown.

直接 Concerta Formula 应同时显示分段依据，例如 “Observed reference through 29.976 h; estimated continuation afterward”，列出尾部公式和 3.5 h 参数，明确观测段 A 与尾部 B。若未来恢复 publishedOnly 选项，应让说明与该选项同步，而非再维护两套静态文案。回归应比较默认显示在观测边界前后的值与说明；不能只断言旧字符串存在。

### C2 · P2 · 应用内隐私摘要遗漏恢复认证部分的发送，并混淆下载与托管备份

**位置：** `src/App.tsx:234`。实现依据：`src/lib/cloud-client.ts:283-296`；`src/lib/vault-crypto.ts:239-255`；`src/App.tsx:236`；`src/lib/reports.ts:157-178`。正确的详细披露位于 `PRIVACY.md:23,53,59,63-67`／`public/privacy.html:32,50,53,55-57`。

**确认事实：** Privacy 摘要称 “Your encryption password and recovery key stay in the browser”。实际完整恢复码由两段独立秘密组成；恢复时 `recoveryAuthSecret` 会发到服务器。解密部分确实不发送，但摘要没有“完整密钥／解密部分／认证部分”的区分，容易被理解为任何恢复秘密均不发送。相邻文案还列举了已不存在的 PDF 导出，并用 “Cloud backups contain current records only” 指代 Current backup 下载，与托管平台保留历史快照的事实边界混淆。

**影响：** 这是用户依赖的简短隐私承诺与实际传输范围不一致；不是发现完整密钥泄露。详细政策准确，摘要应与它一致。PDF 是低影响陈旧文案，可同次清理。

**建议替换整个云端摘要：**

> The server stores encrypted records and a wrapped data key, plus account and session metadata. Your password, data decryption key and complete recovery key are not sent to the server. During recovery, only the independent account-recovery part is sent over HTTPS; the decryption part stays in your browser. Unlocked account records are held in memory without a persistent browser cache. CSV and Current backup JSON downloads are unencrypted. Current backup contains current records only; hosting backups may retain older encrypted snapshots and account metadata.

应继续保留现有说明：删除只影响 active database、独立 guest copy 不随账户删除、旧下载和旧密钥／密文副本不能远程撤回。

### C3 · P3 · 许可证声明当前正确，但 CI 没有保证未来依赖更新同步声明

**位置：** `.github/workflows/ci.yml:55-78,80-111`；`scripts/heroku-build.mjs:8-10`；`scripts/third-party-notices.mjs:183-196`；`tests/third-party-notices.test.mjs:8-77`。

**确认事实：** 当前本地 `--check` 成功，56 包／83 声明章节／22 个 hash-wasm 源码头；声明的 lockfile 哈希与当前安装一致。CI 运行通用单元测试和构建，但不执行真实发行声明的 freshness 检查；现有测试只检查合成依赖树与辅助函数。修改 lockfile 后忘记重新生成声明，仍可能通过这一 workflow。静态声明明确是 darwin/arm64 安装图，而 CI／Heroku 为 Linux，因此不能直接把本地平台逐字比对搬入 Linux CI 并假定必然通过。

**建议：** 建立针对浏览器实际发布依赖的可重复声明清单，或让 CI 在固定平台生成／验证该平台的发行声明；至少校验当前 lockfile 哈希和运行时依赖覆盖，并明确区分平台可选构建依赖。依赖更新 PR 应带声明更新。此项是防止未来遗漏的已确认控制缺口，**不是当前已发生许可证违约**。

## 数据流及承诺覆盖清单

| 范围 | 当前实现与声明核对 | 结论／边界 |
| --- | --- | --- |
| Guest 采集和本地保存 | `GuestSimulator.tsx:25-29,42-70,78-83,116-126,152`；`guest-consent.ts:3-25`；`guest-workspace.ts:51-75`；政策 `PRIVACY.md:9-15` | 默认内存、未选中的可选明文 localStorage、先确认 18+，与政策一致。恢复存储依赖既有确认标记；这不是实际身份或年龄验证。 |
| Guest 同步和清理 | `CloudGate.tsx:99-134,189`；`guest-transfer.ts`／`guest-transfer-storage.ts`；政策 `PRIVACY.md:11-15` | 显式同步、保存后清理匹配副本、失败保留、跨标签新副本保留；合成测试通过。同步记录仍是 simulated，不制造 taken history。 |
| 云端加密／元数据 | `vault-crypto.ts:190-192,212-226,239-267`；`cloud-opaque-flow.ts:19-36`；PG accounts／vaults 表 `cloud-postgres.mjs:65-78` 与 OPAQUE 字段 `cloud-opaque-postgres.mjs:20-31` | AES-256-GCM 加密健康快照、HKDF 包装 key；username/name/account/session/auth protocol/ciphertext size 元数据在外。主政策界限准确。未单独证明密码协议密码学正确性。 |
| Password 与恢复 | `cloud-client.ts:283-296,429-474`；`RecoveryKeyPanel.tsx:5-20` | 恢复仅传认证部分，轮换 data key；改密码只重包同 key，原恢复码仍可用；保存确认不验证持久外部副本。主政策正确，摘要有 C2。 |
| 浏览器缓存／锁定 | `main.tsx:15-17`；`api.ts:134-142`；`cloud-client.ts:156`；`CloudGate.tsx:35-66`；`idle-lock.ts:1-16` | cloud transport 先于账户 App 配置，绕过本地 IndexedDB/outbox。锁定释放应用引用并卸载账户界面；10 min idle、60 s session check／focus check 与文案一致。JS 内存释放不等于取证式擦除，离线不能实时确认服务端撤销。 |
| Cookie | `cloud.mjs:194-215`；`cloud-session.mjs:1-8` | HttpOnly、SameSite=Strict、Secure（生产）、Path=/drug/，24 h 最大寿命；无 sliding renewal。未用真实账户检查登录 Cookie。 |
| 日志／连接信息 | `cloud.mjs:470-471`；`server/index.mjs:751`；`server/heroku.mjs:24-37`；`PRIVACY.md:33-45` | cloud 错误路径不记录 body/key/health/ciphertext/stack；本地记录通用 error code/name。正式服务器响应确认 NEL；“无广告／行为分析脚本”不等于无供应商遥测。没有查看供应商日志。 |
| 第三方／字体／OpenAI | `main.tsx:3-7`；源码 URL、fetch、sendBeacon、console 和环境变量检索；`vite.config.ts:5-10` | 字体打包本地；未发现广告／分析 SDK、健康数据发往 OpenAI 或第三方密码检查服务。公开链接由用户打开。邮箱由 Apple iCloud 处理已披露。 |
| 当前导出 | `reports.ts:29-51,87-154`；`App.tsx:222,236`；`cloud-client.ts:40-41,646,661-662` | CSV 仅实际 taken records 和独立 self-reported symptom 行，明确名义贴剂量、复方分量，保留精确小数；CSV 公式前缀转义。无浓度数值／曲线导出，不会把 starred 曲线改成无标记临床值。JSON 保留当前元数据／模拟。历史档案云端导入拒绝非空 revisions/tombstones。 |
| 未知记录／总量／星号 | `timeline-data.ts:6-12`；`timeline-estimates.ts:17-28`；`TimelineChart.tsx:63-98`；`history-amounts.ts:20-38`；`App.tsx:221` | 全未知显示 dash；部分已知使用 star／Known contributions；不同 analyte、relative units 和未知 ingredient 分离；无记录标为 no record。比例估计不冒充 directComplete；方法说明仍有 C1。`* No drug data` 概括 reference/tail/partial 三种情况不够精确，可酌情改为 “Estimate limits”，但已有紧随解释，未单列故障。 |
| 删除和留存 | `cloud-opaque-postgres.mjs:135-142`；`cloud-postgres.mjs:207-209,213-220`；`PRIVACY.md:53-59` | OPAQUE 删除同事务移除账户、vault、sessions 和 owner-bound challenges；替换快照无 cloud revision archive。限流 hash 可保留到后续活动清理；政策已披露。不能删除外部浏览器、导出、供应商备份；无固定期限承诺。 |
| 本地版 | `api.ts:18-112`；`server/index.mjs` 本地数据库／导出／删除路径；`PRIVACY.md:75-77`；`README.md:47-53` | SQLite、IndexedDB 和 outbox 不端到端加密；修订／软删可入完整备份。与政策一致。本轮未检查个人 data 目录。 |
| 年龄／法律文案／通知 | `CloudGate.tsx:157,196-197`；`GuestSimulator.tsx:152`；`PRIVACY.md:79-87`；`TERMS.md:9,19,51-57` | 18+ 自我确认、个人使用、禁止作为临床管理系统；不声称 FDA 分类、HIPAA／CCPA 合规或专业安全审计。隐私变更公告是运营承诺，静态源码中没有自动公告系统不等于违约。不能把 checkbox 当作特别健康信息披露授权。 |

## 部署供应链、许可证和秘密检查

1. `.github/workflows/ci.yml:9-10,37-56,121-140`：权限默认 contents:read；actions 固定完整 SHA；checkout 不保留凭据；使用 pull_request 而非 pull_request_target；OIDC 和 attestations 写权限限 main push 的后置 provenance job。未发现 PR 输入拼接到 shell 执行的路径。
2. `package.json:23,43`、lockfile、`pnpm-workspace.yaml:1-4`：OPAQUE 精确版本、pnpm 精确版本、frozen lockfile 和依赖 build-script allowlist。工作流 PostgreSQL 容器 `postgres:18` 不是 digest 固定（ci.yml:23），属于可改进的测试基础设施完整性边界。
3. `scripts/heroku-build.mjs:5-10` 只运行本地 TypeScript/Vite，没有 curl|shell 安装链；`scripts/build-metadata.ts:15-32` 只公开 allowlist 元数据与静态文件 hash，不序列化 process.env。Vite 仍有构建环境注入的一般边界：不可把秘密放入前端变量。`SECURITY.md:19` 已说明。
4. `README.md:82,114` 正确区分源码候选、CI attestation 与实际部署。当前 attestation 绑定 frontend build-info，不自动证明所有后端代码、依赖构建、Heroku 环境或将来的响应内容。Heroku engines `24.x` 与 CI 固定 `24.19.0` 也不是永远相同的 toolchain。应保持逐次发布核对，不称为不可篡改供应链或运营者无法读取。
5. 当前 notice inventory 已通过检查；字体 OFL-1.1、MIT／ISC／Apache-2.0／BSD-3-Clause 等文本及 hash-wasm、密码字典附加 notices 被收录。还包含构建依赖 lightningcss 的 MPL-2.0，不能笼统宣传“全部依赖 0BSD”。本轮没有独立追踪 OPAQUE WASM 等所有上游嵌入组件，也不证明未来分发修改的 MPL 组件所需源码提供义务已履行。当前文件已披露此限制。
6. 对源码、公开文档、脚本、配置示例和 tests 做常见 private-key／GitHub-token／API-key／带密码 PG URL 格式的文件名级扫描；命中仅为 `.github/workflows/ci.yml:28,64` 的一次性 CI 密码和 `tests/heroku-config.test.mjs:9` 的 synthetic 凭据。未显示任何个人数据库／密钥内容。`.gitignore:1-19` 排除常见数据和秘密；**未检查 Git 历史、平台 secrets、ignored data 或任意格式秘密**，不能凭本轮宣称整个仓库历史从未泄密。

## 法律原始来源核查及需要运营／专业判断的事项

以下是条件性适用分析，均于本轮查阅官方来源；不把“开源、免费、个人项目、浏览器加密、18+”当成通用豁免。

| 规则 | 本轮确认的官方事实 | 对本项目的判断和待办 |
| --- | --- | --- |
| HIPAA | HHS 说明 HIPAA 面向 covered entities／business associates；多数个人自行选用的健康 app 不受 HIPAA 保护，除非存在适用的提供者关系。[HHS 个人健康应用指南](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/cell-phone-hipaa/index.html) | 当前个人记录用途本身不证明 covered entity 或 BA 身份。未查看任何 BAA／医疗机构合同，不能作 HIPAA 认证或保证“不适用”。现有对外政策没有这类过度承诺。 |
| 加州 CMIA | Civil Code §56.06(a)(b)(d)(f) 可将为消费者维护医疗信息或提供 mental health digital service 的特定业务纳入本章保密责任。[现行 §56.06](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.06.) | 应由专业人员结合运营实体、加州联系和信息处理方式评估。不能因没有诊所、只是免费或仅持密文就自行排除。现有政策不是披露授权，条款也不要求放弃权利；方向恰当但不证明全部 CMIA 义务完成。 |
| CalOPPA | §22575 针对符合条件的商业网站／在线服务，要求显著政策、信息／第三方类别、变更流程、有效日期以及有关 DNT 和第三方跨站收集的披露。[现行 §22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575.) | 当前政策包含这些主题且 footer 有链接；是否为适用商业运营仍需实体事实。提供商的实际独立处理不能只凭应用代码核实。 |
| CCPA／CPRA | CPPA 说明主体、营利性质、加州业务联系及收入／数据数量／出售分享收入等条件；2025 起收入门槛调整为 $26,625,000；另有关系主体规则。[CPPA FAQ](https://cppa.ca.gov/faq)、[调整后的门槛](https://cppa.ca.gov/regulations/cpi_adjustment.html) | 未核实收入、受众、实体关联或服务商合同，因此不能直接认定適用或不適用。无销售／广告功能时 DNT/GPC 不改变代码不是自动违规结论；如实际出现 sale/share，则须重新落实适用的 opt-out signal 义务。 |
| FTC HBNR | 适用的 PHR 包含有技术能力从多来源获取信息、主要供个人管理的可识别电子健康记录；未经授权披露也可构成 breach，并不限黑客入侵。[FTC HBNR 指南](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) | 手工输入、备份导入与目录／参考功能需做事实适用评估，不因没有 wearable API 直接排除；更不能认为服务器仅有密文就免除其他元数据／客户端泄露评估。 |
| 泄露通知 | 加州现行 §1798.82 一般为 30 日，规定理由可延后；超过 500 名 CA 居民，通知后 15 日内向 AG 交样本。FTC 常规个人通知最迟 60 日且不得不合理延迟，人数和替代通知规则不同。[现行 §1798.82](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.)、[16 CFR §318.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318/section-318.5) | `docs/incident-response-runbook.md:18-27` 的条件与时间区分与核查来源一致；没有发现“统一等 60 日”的旧规则误用。无账户邮箱／邮址、无验证批量送达、无免付费号码是仍存在的运营准备缺口，不能仅有网站公告就认定送达完成。 |
| COPPA | FTC 指明儿童导向服务以及明知收集 13 岁以下儿童信息的一般受众服务可能受规则覆盖。[FTC COPPA Rule](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa) | 18+ checkbox 是产品限制，不证明真实年龄，也不自动消除获知未成年用户后的义务。应落实儿童报告处理和最小化验证，勿为“证明成人”擅自增加证件采集。 |
| FDA 软件范围 | FDA 按软件功能、预期用途和失效风险考虑监管，不因网站／手机／个人项目标签直接决定；说明“不提供医疗建议”不是批准／豁免证据。[FDA 软件功能指南](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications) | 个人浓度模拟的预期使用、推荐语和实际功能需专业分类判断；现有 TERMS.md:19 明确不作 FDA 批准、豁免或非器械分类承诺，准确。C1 修复应同步保留非个人浓度边界。 |
| 其他地区 | Washington AG 说明其 My Health My Data Act 对符合在州内经营／面向州内消费者等条件的健康数据业务可能适用，包含 small businesses，并非只管州内公司。[Washington AG FAQ](https://www.atg.wa.gov/protecting-washingtonians-personal-health-data-and-privacy) | 实际服务区域、推广、居民群体及实体事实未核实。该站全球可访问不能单独完成所有州／国际适用分析；本轮不宣称满足全球健康隐私法。 |

### 仍须运营者落实，不能靠改免责声明关闭

- **备份可恢复性与删除后恢复：** 每日计划和两份手动备份证明配置存在，不证明备份成功或可恢复。Heroku 文档明确计划备份失败没有通知；Essential 手动备份是数量上限 5，计划备份为 7 daily days／1 weekly／0 monthly，不能推导所有副本统一七天删除。[Heroku PGBackups](https://devcenter.heroku.com/articles/heroku-postgres-backups) 应安排合成数据或隔离环境演练，验证恢复后不会复活已删除账户／已撤销会话／旧 recovery secret，并确定实际成功检查和失败响应负责人。没有执行生产恢复。
- **日志与手动备份保留期限：** `PRIVACY.md:57-59` 不承诺未核实期限是准确披露，但仍需确定合法必要的保留规则、手动备份轮换和到期处理，以及供应商日志／副本条款。不能把“未知”永久当作已解决的留存管理。
- **NEL 和供应商条款：** 实测头包含 NEL、Report-To、Reporting-Endpoints，配置 `max_age=3600`、`success_fraction=0.01`、`failure_fraction=0.1`，目的地主机 `nel.heroku.com`。这些是浏览器报告配置，**不是 Heroku 日志保留期**。官方说明 NEL 是基础设施遥测；需要停用时官方渠道为联系 Heroku support。[Heroku HTTP Routing](https://devcenter.heroku.com/articles/http-routing#network-error-logging)、[Heroku NEL 停用方式](https://help.heroku.com/NB33WB2D/how-do-i-remove-nel-related-response-headers-from-my-heroku-app) 是否保留以及条款是否合法充分，需供应商／运营判断；本轮没有联系供应商或变更配置。
- **请求和公告：** Treee 应落实邮箱接收／身份控制证明／处理记录；政策更新须真正展示显著公告，不能仅修改 repo。HBNR 条件性替代通知可要求 90 天公告／媒体及免付费电话；应事先确定能够执行的渠道，而不是承诺绝对不会发生需通知事件。
- **临床／监管专业判断：** 本轮核实星号、未知和文件导出语义，并未独立重建成人药代曲线、验证线性比例关系、证明监管分类或临床安全。专业审核前应继续标示 unvalidated，不能升级为 personalized prediction、clinical validation 或 vendor approval。

## 验证记录

- Runtime：Node v24.19.0；现有安装，无重新安装依赖、无包生命周期脚本执行。
- `node scripts/third-party-notices.mjs --check`：通过，56 packages／83 notice sections／22 embedded source headers。
- 合成数据针对性测试：`reports`、`symptom-reports`、`history-amounts`、`guest-consent`、`guest-session`、`guest-transfer`、`guest-transfer-storage`、`model-formula`、`timeline-data`、`timeline-estimates`、`third-party-notices`，**63/63 通过，0 skip**。
- 独立合成运行验证 C1 的 18 mg／32 h 尾部数值与 Formula 矛盾，以及 36 mg 的物理单位参考缩放。所有已有测试通过仍能存在 C1；不能把字符串回归通过当作说明正确。
- 生产公开头：200、Cache-Control:no-store、HSTS、CSP、COOP、CORP、nosniff、X-Frame-Options:DENY、Permissions-Policy、Referrer-Policy:no-referrer 均观察到；这些只证明一次公开页面响应，未核实发布 commit 或已登录请求。
- 本轮未做：生产账户访问／注册、真实密码恢复、真实删除、生产数据库读取、backup URL 生成或下载、恢复演练、Git 历史扫描、依赖漏洞数据库扫描、供应商合同审计、全球法律意见或临床药代审核。

主审查者应先修 C1、C2 并核对所有说明入口；C3 可作为发布维护改进。运营和法律判断项应保留具体未验证状态，不能随文案修复一起标记“全部通过”。

## 第 1 轮修复处置附记（保留上方原始发现）

2026-09-14，主审查者已通知 C1／C2 的 App、model-formula 和边界测试修复完成；本审查者没有再次将这两项视为独立复审通过，留给第 2 轮新审查者验证。

C3 已由本审查者实现：`.github/workflows/ci.yml` 在冻结依赖安装后执行 `node scripts/third-party-notices.mjs --check-portable`。它只读检查 TXT 与 Markdown 的格式、清单计数、当前 lockfile hash，以及所有共享依赖完整声明文本；只允许当前 lockfile 明确 OS／CPU 不兼容的包造成跨平台安装差异。普通可选依赖不因此获得豁免。相同平台保留原有全文件逐字比较；`--check` 仍可单独使用。无法重新读取的另一平台专属 legal text 不声称重新审计；libc-only 差异也不自动豁免。

新增合成 macOS／Linux 图验证成功差异、OS／CPU 限制、共享 legal text 更改、lockfile 更改、普通可选依赖缺失、跨平台兼容包缺失、Markdown 漂移、计数不符和检查不改写文件。10 项 notice 测试通过；当前 56 包的 `--check` 与 `--check-portable` 均通过。未实际执行 Linux CI，未改生成声明内容，未运行 Git 或部署。

主审查者另提供 `/private/tmp/drug-audit-dependencies-2026-09-14.json` 的依赖审计结果：105 total dependencies，已知漏洞分类 info／low／moderate／high／critical 均 0；这是主审查者提供的本次数据库匹配结果，不能推导不存在未知漏洞。本轮主体“未做漏洞数据库扫描”描述的是本审查者自身的原始审查范围，不被该附记改写。
