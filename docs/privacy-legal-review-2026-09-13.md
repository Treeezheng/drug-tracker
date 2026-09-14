# Drug Tracker：隐私法律与发布前缺口复核

核对日期：**2026 年 9 月 13 日**。仅依据美国、加州官方法规和机构资料，以及本轮读取的实现与说明。本文用于确定下一步问题，不是律师意见、完整法律审计、合规认证或 FDA 分类结论。没有操作用户数据库；对外政策与使用条款另在根目录 Markdown 和 public 静态页中同步维护。

**优先确认 CMIA 与健康信息泄露规则；不能仅以“项目小、不受 HIPAA 管辖”结束判断。** 免费、开源、学生项目、AI 编写代码、浏览器加密均不是所有隐私义务的通用豁免。仅发布代码、本人本机使用、向他人提供托管账户，应分别判断。

## 本次采用的产品事实

- 访客默认仅在页面内存演算；用户先作 18+ 自我确认，只有主动勾选记住设备才使用独立 localStorage **明文保存**。年龄未经身份核验；登录本身不上传访客数据。登录后若有访客内容，用户可选择保持独立，或明确同步为加密模拟（状态仍 simulated）。写入确认后才清当前内存和匹配的本地副本；失败、新的跨标签页改动或清除失败时保留副本并告知。加载网站仍向托管方产生网络连接。
- 新公开注册只需用户名与一个密码，不要求邮箱；接口可接收可选显示名。浏览器使用 OPAQUE，上传协议消息而非原始密码；客户端 export key 经 HKDF-SHA256 包装随机数据密钥，再上传健康密文。服务器可见账号、OPAQUE 注册记录、恢复验证 hash、临时认证状态、会话与连接元数据。它们不在健康快照加密范围内。当前公开流程没有旧双密码入口或迁移向导。
- 解锁期间浏览器内存可读记录；下载 CSV 和当前 JSON 备份是明文。账户记录没有持久浏览器缓存或离线队列，但访客存储仍可能存在。
- 云端当前快照不保留完整更正历史；备份可能保留旧密文。自助云账户删除经 OPAQUE 再认证后，以事务删除 active account、vault 与全部 sessions；不清除下载、独立访客存储或提供商备份。
- 界面展示一个完整恢复码，其中账户恢复凭证与数据密钥各自随机、彼此独立；恢复时只把账户凭证部分传给服务器，数据密钥部分留在浏览器。它能在忘记密码时恢复账户与记录并生成新密码包装和新恢复码。新码展示后须勾选已保存确认；这不是备份已实际保存的核验，也不是身份验证或双因素认证。运营者无可用完整码副本；密码和恢复码均遗失时没有客服或邮箱绕过解密的恢复方式。
- 服务器 session 为 24 小时绝对上限，浏览器 10 分钟无活动锁定并在返回时重新检查。OPAQUE 在浏览器使用 Argon2id 拉伸，新的 v3 key wrapper 使用 client export key 经 HKDF-SHA256 派生的密钥；不是服务器共享 session key。Change password 只重包原数据密钥，恢复码不变；Replace recovery key 和账户恢复才更换数据密钥、重加密当前快照并提供新码。旧副本不会被轮换追溯删除。以上是候选源代码行为，最终全套测试、commit、构建摘要及生产版本以[发布核验记录](./opaque-release-review-2026-09-13.md)为准。
- 源码未集成广告、行为分析追踪或远程字体；Heroku NEL 仍可能由响应头触发独立浏览器诊断报告，Heroku/Salesforce 处理连接元数据。实际平台配置、日志与副本留存须核实；不把可查 Logplex 的短期历史当全部平台删除保证。详见[Heroku 核对](./heroku-retention-review-2026-09-13.md)。

事实依据：[README](../README.md)、[当前隐私说明](../PRIVACY.md)、[CloudGate](../src/components/CloudGate.tsx)、[访客存储](../src/lib/guest-workspace.ts)、[云客户端](../src/lib/cloud-client.ts)、[云服务](../server/cloud.mjs)。这是代码与文档审阅，未验证真实生产数据库、主机日志或备份生命周期。

## 适用条件与实际影响

| 规则 | 官方要求与本项目的判断边界 |
| --- | --- |
| **加州 CMIA，Civil Code §56.06** | 某些以维护个人医疗信息为目的的业务，以及为个人管理这些信息或医疗状况而提供软件的业务，可仅就 CMIA 被视为医疗服务提供者。条文没有 CCPA 的收入或人数门槛。药物/症状记录功能需要优先审查；是否构成 business、法定 medical information，以及仅持密文时的具体角色，尚需专业判断。精神健康数字服务另有定义，不能仅凭 ADHD 药名断言满足。[§56.06](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.06.)、[§56.05](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.05.) |
| **CalOPPA，B&P Code §22575** | 面向加州居民并在线收集可识别个人信息的商业网站/服务，须显著提供隐私政策；是否属商业需确认。政策应涵盖收集/共享类别、如有的查阅更正流程、重大变更通知方式、生效日期，以及适用的跨站追踪/DNT 说明。低于 CCPA 门槛不自动免除此要求。[§22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575.) |
| **CCPA/CPRA** | 通常先要求为所有者利润或经济利益运营、在加州经营并决定处理目的/方式，再满足一项门槛：上一年年总收入超过 **$26,625,000**；每年买入、出售或共享至少 **100,000 名消费者或家庭**的信息；或至少 **50% 年收入**来自出售/共享信息。关联实体等另有规则。“十万人”不是普通访问量或所有收集人数。当前个人小规模描述不能证明触发，也不应写成永久豁免；收费、数据合作或运营关系改变后重评。[§1798.140(d)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140.)、[CPPA 当前调整额（2025 年起）](https://cppa.ca.gov/regulations/cpi_adjustment.html) |
| **FTC Health Breach Notification Rule（HBNR）** | 可覆盖某些不受对应 HIPAA 身份规则约束的个人健康记录供应者、相关实体及服务商。PHR 要求为个人管理的可识别健康记录，并**具有从多个来源取得资料的技术能力**，不要求每个用户实际启用。FTC 举例包括用户输入体重加餐厅热量 API。因此用户输入、目录和备份导入应逐一评估；不能保证静态目录一定算或一定不算第二来源。未经授权披露也可能构成泄露。[16 CFR §318.2](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318/section-318.2)、[FTC 官方指南](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) |
| **加州泄露通知 §1798.82** | 符合适用主体与资料条件、未经授权取得信息时可能触发；加密数据连同可用解密密钥/凭证失窃也可能触发。现行一般期限为发现或获知后 **30 个日历日**，保留法定延迟；同一事件须通知**超过 500 名加州居民**时，消费者通知后 **15 个日历日**内须向 AG 提交样本。不能照搬旧的无固定天数概述，也不能只采用 FTC 的 60 天期限。[§1798.82](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.) |
| **HIPAA 与 FTC Act** | 直接由消费者自行使用、非 covered entity/business associate 提供的健康 app 通常不因记录医疗资料自动受 HIPAA 管辖；与诊所/保险方合作后需重新判断。FTC 对适用主体的误导或不公平行为另有执法权；隐私承诺应与实际处理一致。[HHS 消费者 app 指南](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/cell-phone-hipaa/index.html)、[FTC 健康 app 法律工具](https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool) |

**加密是重要防护，不是“无法泄露”的法律结论。** HBNR 的 unsecured 排除取决于指定技术方法和密钥/解密流程是否也受损；不能仅凭使用 AES 宣布任何事件都无需报告。运营者可更改下次提供的 JavaScript，浏览器脚本、设备与明文导出也有独立风险。[HHS 指定处理方法](https://www.hhs.gov/hipaa/for-professionals/breach-notification/guidance/index.html)

## 已补说明与仍需落实的运营事项

1. **运营者与私密渠道已公开。** 当前政策明确 Treee 和用户授权公开的 uhenrywksp@icloud.com。公开 GitHub issue 不适合接收健康资料、密码或恢复密钥。邮箱存在不等于已有全天值守或批量通知能力。
2. **确定托管与留存事实。** 核对实际主机、数据库、代理、日志/备份提供商及地区；给出已执行的保留期限或确定期限的方法。自助删除只处理 active 数据，不能承诺即时清除所有副本。现有生产网站和新认证候选版本须分别核验，不能把代码完成直接写成新版本已上线。
3. **补上政策生效、重大变更与请求流程。** 页脚及注册前能打开政策；将条款、隐私说明和医疗范围分开。隐私说明不等于用户授权一切用途，注册接受条款也不自动满足 CMIA 的披露授权要求。是否属于 CMIA、披露是否需要授权或适用例外，由专业人士确认。[§56.10](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.10.)
4. **落实事件响应的实际通知能力。** 已新增[事件流程](./incident-response-runbook.md)，分别列明加州一般 30 天与 FTC HBNR 的个人/监管/媒体时钟。当前不收邮箱，需要安排法律允许的直接或替代渠道；尚无已验证批量联系机制或免付费号码，不能假定在网站贴一句话就够。FTC 少于 500 人的年度监管报告期限是年度结束后 60 天，不是次年 1 月 1 日前。[FTC 通知程序](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)
5. **让“加密”宣传严格对应范围。** 可以说明已实现浏览器加密健康快照；不能称访客存储或下载文件同样加密、没有任何元数据、运营者永远不可能接触明文、已通过独立安全审计或已满足所有医疗法规。OPAQUE 也不意味着弱密码无法被离线猜测：认证记录与服务器 setup secret 一同失窃时须具体评估。法律研究和自动测试均不构成这些保证。
6. **获得针对真实功能的专业确认。** 尤其是 CMIA、HBNR 多来源标准、用户年龄/面向儿童的实际定位，以及患者 ng/mL 浓度模拟的 FDA 用途边界。后者是独立的软件监管问题，详见[既有 FDA 研究](./california-privacy-research.md#7-fda-软件监管浓度模拟须独立判断用途)，不能通过“仅模拟”页脚直接确定豁免。

对外条款已另行起草，但不作为法律审核完成的证明。任何责任限制都应避免声称排除法律不允许排除的责任；加州 §1668 对以合同免除自身欺诈、故意侵害或违反法律责任设有限制，具体条款效力仍需结合事实判断。[Civil Code §1668](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1668.)
