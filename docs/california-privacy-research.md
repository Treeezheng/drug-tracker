# 加州健康记录网页：法律适用初查

核对日期：**2026-09-13**。范围为个人开源 Drug Tracker：访客在浏览器明文保存演算，可选择注册；账户药物、症状、库存等由浏览器加密后保存在运营者服务器。本轮只查官方法规与机构资料，没有修改程序或对外隐私声明。本文是条件性法律研究，不是合规认证或针对运营者全部事实的法律意见；正式向他人提供健康记录托管前，应让熟悉加州健康隐私的律师确认适用范围。

**有相关法律，而且“免费、开源、学生项目、不是医生、使用 E2EE”都不是通用豁免。** 只发布代码、只在本人 Mac 使用、公开提供浏览器演算、替他人托管账户，是不同事实。应先明确谁运营、是否具有商业/经济利益、用户范围以及实际信息流，不能仅看页脚称谓。

## 1. 优先确认 CMIA，而非只考虑 HIPAA

加州《医疗信息保密法》CMIA 的 Civil Code **§56.06(a)/(b)** 专门覆盖某些维护个人医疗信息、让个人管理资料的业务，以及向消费者提供这类软件/硬件的业务；就 CMIA 而言可被视作医疗服务提供者。条文本身没有 CCPA 的收入或十万人门槛。**因此“我们不诊断，只替用户记药”不足以单独排除适用。** 这并不使运营者在所有其他法律下成为医生，也不自动触发 HIPAA。[§56.06 原文](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.06.)

是否属于该条的 business、资料是否属于法定 medical information、浏览器与密文托管构成何种维持/接收关系，需要按具体事实判断。ADHD 相关功能还应检查 §56.06(d)；但 §56.05 对 mental health digital service 同时考察收集、宣传和用于促进心理健康服务，不能仅因药名与精神健康有关就认定所有条件都满足。[§56.05 定义](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.05.)

若适用，资料披露原则上需要合格授权或法定例外，不能用一句“非医疗建议”代替保密责任。[§56.10](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.10.) §56.101 包含保密与某些电子病历系统变更/删除留痕要求，但 (d) 另有联邦 EHR 定义限制；**不能直接断言普通个人日志必须采用临床 EHR 全套留痕，也不能仅凭现有加密宣布满足该条。** 当前云版只有现存快照，应列为律师确认的问题。[§56.101](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.101.)

## 2. CalOPPA：小网站也可能需要正式隐私政策

Business and Professions Code **§22575** 针对从加州居民网上收集可识别个人信息的商业网站/在线服务，要求显著提供隐私政策。它不使用 CCPA 的规模门槛；是否属 commercial 仍需判断，免费提供页面不能单独证明非商业。政策须说明收集类别、可能共享的第三方类别、如有的查阅/更正流程、重大政策变更通知方式、生效日期，以及适用的跨站追踪/DNT 情况。[§22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575.)

对本项目的实际事项：分开说明访客 localStorage 明文、账户密文、账号与连接元数据、主机/备份、导出、删除流程和可联系的运营者；不能只写“不卖数据”。政策变更如何通知、是否有第三方跨站追踪，需要与最终部署核对。**本研究不宣称当前 Privacy 已满足 CalOPPA**，也没有擅自修改它。

## 3. CCPA/CPRA：不是所有个人项目都自动适用

主要 business 定义包括在加州开展业务、决定个人信息处理目的/方式、为所有者利润或经济利益运营，并符合至少一项门槛：上一年度年总收入超过调整后数额；每年买入、出售或共享至少 **100,000 名消费者或家庭**的个人信息；或至少 **50% 年收入来自出售/共享个人信息**。十万人条件不是单纯网页访问量，也不是任何收集都计入。关联实体等另有规则。[Civil Code §1798.140(d)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140.)

截至本次核对，2025 年起生效的收入门槛是 **$26,625,000**，不是未经通胀调整的 $25 million；CPPA 说明奇数年调整，因此这是当前 2026 年应核对的已公布额度。[CPPA 官方调整表](https://cppa.ca.gov/regulations/cpi_adjustment.html)

按“个人、小规模、无广告销售”的描述，CCPA 并非最可能首先触发的规则，但还要确认实际运营与关联关系。**低于 CCPA 门槛并不排除 CMIA、CalOPPA 或泄露通知法。** 以后收费、广告合作、机构合作或规模增长时，应重新判断。

## 4. 加州数据泄露通知：2026 年期限已改变

Civil Code **§1798.82** 涵盖在加州经营、拥有/许可计算机化个人信息的个人或企业。触发条件包括未经授权取得未加密的法定个人信息；加密信息若连同可使其可读的密钥/凭证被取得，也可能触发。定义包括相应的姓名与医疗信息组合，以及可登录在线账户的用户名/邮箱加密码等组合；并非任意匿名药名都自动触发。[§1798.82(a)/(h)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.)

**SB 446 自 2026-01-01 生效：一般须在发现或接到泄露通知后 30 个日历日内通知，保留执法、确定范围及恢复系统完整性等法定延迟。** 同一事件需通知 **超过 500 名加州居民**时，还须在通知消费者后 **15 个日历日内**向 AG 提交不含个人信息的样本。受托维护但不拥有资料者另有立即通知所有者的义务。不要照搬旧文章或将 FTC 的 60 天上限当作加州统一期限。[现行 §1798.82](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.82.)

账户不收邮箱，仍需事先考虑通知方式与联系机制，不能把无联系方式当成无通知义务。该条有特定替代通知规则，不等同于随意发一条 GitHub issue。安全措施还应评估 §1798.81.5 的合理安全要求及 CMIA/HIPAA 等例外之间的关系。[§1798.81.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.81.5.)

## 5. FTC Health Breach Notification Rule：健康应用的重要联邦规则

HBNR 可覆盖不在 HIPAA 对应身份范围内的 PHR 供应者、关联实体和服务商；FTC 明确某些企业与非营利机构均受约束。当前定义把跟踪药物、症状、睡眠、疾病等的在线服务纳入 health care services or supplies。PHR 还要求个人可识别健康资料、为个人管理，以及**具备从多个来源取得资料的技术能力**；不要求每位用户实际启用所有来源。[16 CFR §318.2](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318/section-318.2)、[FTC 指南](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

**多个来源不等于两家医院或两份个人健康记录。** FTC 官方例子包括“用户每天输入体重 + 从餐厅菜单 API 获取热量”。所以不能因没有 Apple Health 就保证排除 HBNR；本项目的用户输入、内置药品资料、备份导入能力和未来 API 必须逐一评估。这个类比表明需要法律判断，并不直接证明静态药品目录必然构成第二来源。[FTC 多来源例子](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0)

若属于覆盖对象，未经授权披露也可能是 breach，不限于黑客入侵。涉及 unsecured 可识别健康资料时，通常需无不合理延迟且最迟发现后 60 天通知个人；达到 500 人时向 FTC 同时报告，人数更少时 FTC 年度报告时间不同，另有媒体规则。加州较短期限仍须单独处理。[FTC 通知说明](https://consumer.ftc.gov/business-guidance/health-breach-form)

**E2EE 是风险降低措施，不是自动豁免证明。** 只有满足适用加密标准、且解密过程/密钥未受损等条件，才可能使特定事件不属于 unsecured 信息泄露；浏览器被恶意脚本控制、原始密钥/导出明文丢失是不同事实。[HHS 指定安全处理指南](https://www.hhs.gov/hipaa/for-professionals/breach-notification/guidance/index.html)

## 6. HIPAA：直接面向消费者通常并不自动适用

HHS 说明，通常由消费者自行使用、并非由 covered entity 或其 business associate 提供的健康 app，不会仅因用户输入/下载医疗信息就获得 HIPAA 保护。当前个人直接服务模式应先判断运营者身份；以后替诊所、医院或保险机构处理受保护资料，结论可能改变。**“不适用 HIPAA”与“所有隐私法律均不适用”完全不同。**[HHS 消费者 app 说明](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/cell-phone-hipaa/index.html)

## 7. FDA 软件监管：浓度模拟须独立判断用途

补查日期：**2026-09-13**。这是联邦要求，在加州运营同样要考虑。FDA 按具体软件功能与预期用途判断，浏览器网页与手机 app 没有天然区别。单纯整理、记录、展示个人健康资料，可能属于非器械功能；帮助自我管理但不提供具体治疗建议的某些器械功能，则可能属于 FDA 当前暂不执法的范围。**“不是器械”“属于器械但暂不执法”“已获批准/许可”是不同结论，不能相互替代。**[FDA 软件政策（2022，现行官方页面）](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications)、[FDA CDS FAQ，第 1、4、5 问](https://www.fda.gov/medical-devices/software-medical-device-samd/clinical-decision-support-software-frequently-asked-questions-faqs)

当前 **2026-01-29** 版 CDS 指南依据 FD&C Act §520(o)(1)(E) 说明的非器械 CDS 排除，要求面向医疗专业人员等条件；患者自己能看到公式、源代码或论文，并不因此满足这一排除。指南把患者使用的胰岛素剂量计算列为器械例子，但这不是本项目的分类认定，也不表示未满足 CDS 排除的任何软件都必然受到同样监管。[最新 FDA CDS 指南，§IV(3)/(4)、§V.B 例 28](https://www.fda.gov/media/109618/download)

**对本项目的推论：** 服药次数/库存记录与基于用户给药时间呈现 ng/mL 曲线，应分开评估；如果后者被设计或宣传为预测某位患者的药物暴露、决定补药时间、剂量或治疗效果，就可能进入患者治疗分析的软件监管范围。仅出现 ng/mL 不足以独立定性，但“模拟”标题也不能保证排除。FDA 明确建议进行患者特定分析的开发者咨询适用要求。[FDA Digital Health Policy Navigator，第 7.F 步](https://www.fda.gov/medical-devices/digital-health-center-excellence/step-7-does-device-software-functions-dsf-and-mobile-medical-applications-mma-guidance-apply)

已核对现有页脚：它说明个人记录/模拟、曲线不是实测、不得据此改药，**没有声称 “not a medical device”、FDA approved 或 FDA exempt**，无需因本次研究再堆叠警告。然而免责声明只表达用途与限制，不能代替分类判断；21 CFR §801.4 的客观意图还可由设计、宣传及分发情境证明。下一步应带上真实界面、数学模型、输入/输出和推广措辞，向熟悉 FDA 数字健康的专业人士或 FDA Digital Health 团队确认。当前报告既不认定已豁免，也不认定已批准；本轮没有改模型、功能或页脚。[21 CFR §801.4](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-801/subpart-A/section-801.4)

## 对当前项目的优先建议

1. 正式向他人提供账户托管前，针对 **CMIA §56.06 与 FTC HBNR 多来源标准**做一次有明确数据流的法律适用确认；这是比直接套大型企业 CCPA 清单更有针对性的下一步。
2. 保留准确、可见的隐私政策和运营者联系渠道；把真实托管商、日志、备份期限、政策变更方式核实后再写。医疗免责声明说明用途，但不能代替隐私政策或法定保密义务。
3. 建立精简的事件响应与通知计划，记录发现时间、范围、受影响数据、密钥是否受损、通知对象/渠道；不把“使用 AES”当作停止调查的理由。
4. 继续让访客与账户数据分离、减少不需要的收集和第三方追踪，维护依赖和服务器，并测试访问隔离、删除与恢复。公开源代码及 AI 生成代码的说明不改变运营事实。

这些是本项目的研究结论与实施优先级，不是要求现在新增复杂弹窗，也不代表本轮获得了律师审阅、合规认证或监管批准。
