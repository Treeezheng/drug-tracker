# 云端加密客户端适配层

2026-09-13。实现文件 `src/lib/cloud-client.ts`；与 `vault-crypto.ts`、独立 `server/cloud.mjs` 协作。本文描述已实现模块行为，不等于生产部署完成或独立安全审计。

## 接口与流程

`createCloudClient({apiBase?: string, fetch?: typeof fetch})` 默认使用同源 `/drug/api`，提供 `session()`、`register(username,password,name?)`、`login(username,password)`、`loadVault()`、`setupVault(vaultPassphrase,initialData?)`、`unlockVault({vaultPassphrase}|{recoveryKey})`、`lock()`、`logout()`、`getState()` 和兼容现有业务接口的 `request(path,method,body,ownerId)`。

典型顺序为 session/register/login → loadVault → setup 或 unlock → 将 request 挂入云版业务 API。register 只发送账户字段，setup 默认建立空数据，不读取或迁移本机账户或访客演算。setup 返回一次 recoveryKey；恢复密钥就是完整数据加密密钥，必须私下妥善保管。模块不保存登录密码，因此无法在以后每次解锁时检测密语是否恰好等于登录密码。界面必须要求独立密语，在本次登录仍知道登录密码时可额外拒绝二者相同。

服务端收到的健康资料只有整个 AppData 的密文：profile、doses、scenarios（含 comparisonDoses）、favorites、checkins、inventory 一起序列化。不把账号登录密码、会话或原始恢复密钥加入 AppData。所有 vault 请求绑定登录响应中的稳定 owner ID，使用 `X-Dose-Owner`；密文 AAD 同样绑定该 ID。`credentials: same-origin`、`cache: no-store`。适配层不调用 IndexedDB、localStorage、Cache API 或明文 outbox。

这一存储保证只针对加密账户适配层。云构建的独立访客演算器会将模拟草稿与演算偏好保存在明文 localStorage；它不经此适配层，不会自动上传到新注册或现有账户。页面必须清楚区分访客工作区和正式账户记录。

## 保存、冲突与断线

每次编辑先经过有累计 16 MB 字节预算的安全 JSON 副本，再由既有 `parseBackup` 校验医学记录与时区字段，最后加密。每次新的加密生成新 nonce。每条记录 revision 在本地递增；whole-vault expectedRevision 交由服务端原子比较更新。客户端将写操作排成顺序执行，成功确认后才更新内存中的已确认数据。其他设备的并发修改返回 409，必须刷新并重新核对待保存输入，绝不盲目覆盖。

网络中断返回 `ApiError` status 0，不会以 TypeError 触发旧离线队列。未获确认的待写入密文仅暂存内存。重试同一次保存时先读取服务器：若服务器已经保存完全相同密文及包装密钥，直接确认成功；若服务器还在原 revision，重新提交完全相同的密文 envelope（不重新使用旧 nonce 加密）；若已经出现其他变更，报告冲突。未确认的保存解决前不允许另一项保存取代它。关闭、刷新、锁定页面会释放这些内存引用；没有离线持久化保证，错误提示明确要求保持页面并重试。

首次创建同样保留尚未确认的密钥、包装 envelope 与恢复码，仅在内存。若保存确认和随后的对账查询都失败，下一次重试先验证原密语再对账：已经成功则返回原恢复码，尚未保存则原封重传同一份密文，避免生成第二把无法对应原数据的密钥。若用户锁定或关闭页面，仍可使用原密语解锁服务器上已成功创建的 vault；未显示的恢复码不会被服务器恢复。

`/data` 显式在线刷新最新密文并解密。`/export` 返回当前已确认内存快照，使用 `format: dose-timeline-backup`、`schemaVersion: 1`、`scope: current-data`，可由既有备份解析器恢复。`/import` 支持明确 merge/replace；merge 保留现有 ID，并避免同产品同规格 favorite 的语义重复。非空 revisions 或 tombstones 的完整历史备份明确拒绝，不会悄悄丢弃历史。此云版只保留当前更正后的记录与删除后的当前状态，无本机版完整审计历史。用户的原始导入文件不修改。

导入保留医学内容和稳定 ID，但为本账户写入的记录建立当前修订号：已有 ID 为旧 revision + 1，新 ID 为 1；merge 跳过的现有记录不改变。这样明确恢复较早内容时，也不会让版本号倒退并使旧编辑意外匹配。备份里的历史版本号仍在用户原文件中；这不是完整审计历史迁移。

PUT 使用完整快照替换并保留创建时间；删除的 patch removal、旧药 assumptions、ingredient 字段不会从旧快照复活。省略可选 note 时保留旧 note，显式空字符串可清除。历史产品名称、单位、原始复方规格、十进制数量、成分、备注与所有现有字段保留在加密数据里，不以最新目录重写。

## 锁定边界

generation 标记阻止异步 crypto/network 完成后把已经锁定的数据重新放回内存，排队的旧操作也会拒绝。独立 authQueue 串行登录、注册和注销的完整网络请求；取消界面不会让迟到 Set-Cookie 越过后来的认证请求，尚未开始且已取消的认证不会发送。session 读取等待先前认证。这个队列作用于同一客户端实例；跨标签页仍由 owner header、服务端 401 与 Gate 检测 owner 变化后锁定来处理。`logout()` 在网络注销前立即本地锁定；若远端注销失败，明确说明服务器会话可能仍有效。界面也必须在成功和失败两条退出路径卸载 App，因为界面已经得到的旧返回值无法由适配层收回。

`lock()` 只清除此模块持有的密钥和健康数据引用；JavaScript 不保证内存物理擦除，也不能收回其他组件复制过的值。生产 HTTPS、登录保护、来源策略、静态构建完整性以及实际设备界面测试仍由集成层负责。恶意部署的 JavaScript、XSS 或有权限扩展可能窃取解锁后的数据；AES-GCM 与 CAS 不提供恶意服务器回滚检测。原语依据与版本边界见 `docs/vault-crypto-design.md`。

## 验证

专用测试覆盖完整数据与中文往返、真实 DoseEditor patch→IR 更正、四行并发保存、医学 schema 拒绝、全库和记录 revision 冲突、写前断线、写后丢失确认、重试幂等、锁定中的已发送和排队操作、错误密语/恢复元数据、导入合并与完整历史拒绝、favorite 多规格、退出清钥及离线退出。Node WebCrypto 与模拟云传输测试不能替代真实浏览器及生产服务器的集成验证。

本模块原有专用测试 24 项通过，注册/认证串行专项另 6 项通过；原语测试 15 项通过。此数量仅对应上述模块，不代表整个应用已完成全部测试。
