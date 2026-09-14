# Heroku 备份、日志和 NEL：官方能力与实际配置

初次核对日期：2026-09-13；实际备份配置更新：2026-09-14。以下区分官方文档和发布负责人在 Heroku Dashboard、官方 CLI 中实际完成的核对与配置。此次文档更新没有读取用户记录、下载生产数据库或执行恢复。

## 账户实际查看范围

发布负责人于 9 月 13 日从 Dashboard 核对：Resources 为 **Basic dyno + Heroku Postgres Essential 0**；数据库 **PostgreSQL 18.3，Available**，Rollback unsupported。Durability 页面将 Continuous Protection / Postgres Rollbacks 标为 Essential 上 Not Available，并提供 Manual Backups & Data Exports。初次查看时列表没有备份条目；之后已实际完成以下操作：

- **手动备份 b1：**2026 年 9 月 13 日 23:55（America/Los_Angeles）创建成功，Dashboard 显示完成，大小 **17.1 KB**。未下载或读取备份内容。
- **每日备份计划：**2026 年 9 月 14 日，发布负责人通过官方 CLI 的浏览器授权登录后，为 `drug-tracker` 的 `DATABASE_URL` attachment 设置 **每天 02:00 America/Los_Angeles** 备份；`pg:backups:schedule` 返回 `done`。随后 `pg:backups:schedules` 实际返回 `DATABASE_URL: daily at 2:00 America/Los_Angeles`，确认排程已生效。**尚待首次定时运行**；已配置排程不是每日备份均已成功执行的证明。
- **费用：**当前配置仍为 Basic **$7/月**加 Essential 0 **$5/月**，合计约 **$12/月**。本次没有升级套餐或开通额外收费服务；用户授权的额外备份预算为每月不超过 $20，该授权本身不表示已产生费用。

以上备份均由 **Heroku** 提供，尚未配置另一独立供应商的异地备份，也**尚未进行恢复演练**。已创建备份和排程不能证明备份可成功恢复；恢复能力需单独在隔离环境中验证。region、generation、drains 未在此次核对中得到完整证明；也没有取得所有平台内部日志和备份统一最长保留期限的证明。

## 官方能力

| 项目 | 官方事实 | 不能推出的结论 |
| --- | --- | --- |
| Essential 手动 PGBackups | 最多保留 **5 份**，超过上限捕获新备份时删除最旧一份。[PGBackups](https://devcenter.heroku.com/articles/heroku-postgres-backups#manual-backup-retention-limits) | 是份数，不是 5 天；没有新捕获不意味着旧备份到期。 |
| Essential 计划 PGBackups | 若已配置：日备份保留 **7 天**、周备份 **1 周**、月备份 **0 月**。排程失败不自动通知；换库/attachment 可能丢排程。[排程与留存](https://devcenter.heroku.com/articles/heroku-postgres-backups#scheduled-backups) | 计划支持不等于当前已启用，也不是所有副本七天必删。 |
| 物理备份与 WAL | 专门的 Data Safety 文档称所有 PostgreSQL 数据库有物理备份，位于同 region；Essential 无用户可用 rollback/fork/follower。文档未给所有物理副本统一最长保留天数。[Continuous Protection](https://devcenter.heroku.com/articles/heroku-postgres-data-safety-and-continuous-protection) | Dashboard 的 Essential 功能不可用，与文档的底层物理副本说明须分别记录；不宣称本账户已享有可操作的 Continuous Protection。PGBackups 列表空不等于无平台副本；active DELETE 不改写旧快照。 |
| PGBackups 地域 | 官方说明 PGBackups 逻辑备份存美国；这与同 region 的物理备份不同。[Data Residency](https://devcenter.heroku.com/articles/heroku-postgres-backups#data-residency) | 不可仅看应用 region 就承诺每一种备份的地域。 |
| 可查应用/路由日志 | Cedar Logplex 最近 **1,500 行**、最多约 **一周**的短期历史；Fir 没有此历史。额外 drain/add-on 可另存。[Logging](https://devcenter.heroku.com/articles/logging#log-history-limits) | 不是所有 Salesforce、NEL、安全/账单日志一周删除的保证；短历史也不等于已配置告警。 |
| 数据库日志 | PostgreSQL 查询日志服务限 Standard 及以上，Essential 不含。[Postgres logs](https://devcenter.heroku.com/articles/postgres-logs-errors) | Essential 没有数据库日志不等于没有 HTTP router 或提供商日志。 |
| NEL | Cedar Common Runtime 响应头可令支持浏览器向 Heroku 上报采样网络表现；由 Salesforce 隐私声明覆盖。[HTTP Routing](https://devcenter.heroku.com/articles/http-routing#network-error-logging) | 应用不嵌入 analytics JS，不代表浏览器不会向平台单独发报告。 |

发布前或配置改变时，由负责人检查应用 generation、PG tier/region、`pg:backups` 与 `pg:backups:schedules`、log drains/add-ons、实际生产 `NEL`/`Report-To`/`Reporting-Endpoints` 响应头，并保存不含秘密的时间戳与结果摘要。不要在公开记录中粘贴数据库 URL、备份签名 URL 或完整生产日志。

Router 日志可含路径、query、来源地址及响应信息；官方提供 `http-router-no-log-query` flag 以隐藏 query。[Router log redaction](https://devcenter.heroku.com/articles/http-routing#query-string-redaction) 是否启用以实际查询为准。药物、密码或恢复密钥不应进入 URL。

仍待运营者完成或确定：核对每日计划的实际执行结果、备份失败告警、独立供应商备份方案、平台内部 NEL/安全日志最长留存、物理备份到期安排和恢复演练。未取得提供商证明前，对外保留“没有核验全部提供商副本的统一最长保留期限”；不编造“已自动监控”“每天均已成功备份”或固定彻底擦除期限。后续 CLI 查询应继续使用已授权的实际账户，只记录脱敏摘要；上文未列为已执行的核对方法仍是待办事项。
