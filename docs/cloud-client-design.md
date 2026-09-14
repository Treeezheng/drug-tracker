# 云端单密码客户端

核对日期：2026-09-14。`cloud-client.ts` 经同源 `/drug/api` 连接云 API，`cloud-opaque-flow.ts` 编排 OPAQUE，`opaque-client.ts` / `opaque.worker.ts` 运行固定1.1.0协议库，`vault-crypto.ts` 加密完整 AppData。这里描述本轮源码，不自动代表已部署版本。

## 新账户与登录

```ts
registerSecure(username, masterPassword, name?) // -> {recoveryKey}, opened empty vault
loginSecure(username, masterPassword)          // -> void, opened decrypted vault
recoverSecure(username, recoveryCode, newMasterPassword) // -> {recoveryKey}, opened vault
```

新注册一次原子创建账户、v3包装、空vault和session，不自动上传访客或本机数据。只有当前操作 generation 有效、返回账户/username符合预期、包装正确且解密后的数据通过领域schema后，才设置公开的 unlocked 状态。

客户端只传 OPAQUE 消息，不传主密码/client state/export key/DEK。正常登录没有任何 raw-password fallback。服务端固定identifier `drug-tracker:opaque:v1`，客户端绑定规范 username；握手结束检查返回 server public key 与该次取得的配置一致。TLS/本站JS的真实性仍是必要前提，配置获取不是外部公证。

生产没有旧双密码入口或迁移向导。旧方法仅保留给明确 synthetic fixture 回归，生产服务器关闭相应原始密码路线。旧v1/v2密文原语保留兼容读。

## 安全操作

以下是UI调用的**虚拟客户端接口**；其中密码字段不直接发网络：

| 调用 | 实际行为 |
| --- | --- |
| POST `/auth/change-password` `{currentPassword,newPassword}` | OPAQUE fresh reauth取得change-purpose grant；新registration + 同DEK重包装；原子替换认证record/包装并撤销旧sessions；恢复码不变 |
| POST `/vault/rotate-key` `{password}` | OPAQUE fresh reauth取得rotate-purpose grant；新DEK重加密全部记录 + 新auth恢复token；原子替换后返回新完整恢复码 |
| POST `/auth/logout-all` `{password}` | 同步清本地key/data，再用仅公开username/id和新worker完成fresh reauth；网络只发送logout-purpose grant；服务器撤销所有sessions |
| DELETE `/account` `{password}` | fresh OPAQUE proof + delete-purpose grant；成功删除账户/vault/sessions并清客户端；错误密码保留当前资料；可能已提交的断线错误先锁定 |
| GET `/security` | 返回当前session建立/到期时间、活动会话数和7天（168小时）寿命，不返回健康记录 |

grant均绑定owner、session、认证version、用途、请求来源和TTL；服务器提交时再次检查。客户端不用sessionKey包装DEK。`recovery/start`只发码内owner及新registration request；`recover/authorize`只发32-byte auth部分；浏览器本地解密旧vault成功后才发送新加密组合。完整恢复码与DEK部分不进入body。

## 确认、断线与并发

所有记录写入共用队列，认证cookie请求另有串行队列。安全操作同时协调两者；不会让晚到Set-Cookie覆盖同实例更晚认证。取消尚未发送的工作不触发wire。已到达服务器的操作可能完成，generation只阻止晚结果在客户端重新打开数据。

记录保存先复制和校验，再生成新nonce；只有收到匹配CAS确认才切换已确认内存状态。409不覆盖另一设备。原子密码/恢复操作先要求当前完整快照与服务器一致；待确认期间禁止普通刷新/保存，但允许导出原已确认快照。

安全finish丢ACK时，立即用新密码进行一次完整OPAQUE登录。如果服务器的新包装精确匹配，且新DEK解密后领域验证通过，则确认同一组合并返回原恢复码，无第二次写入。再次失联则暂存key/envelopes/恢复码及仅用于同进程重试输入比对的随机salt+SHA256 tag；**不持久化密码、恢复码或待确认材料**。

重试先确认输入与原未确认密码相同，再尝试新认证。已提交则返回原恢复码；明确的新认证失败可重新开始，但必须再次取得原账户/恢复授权并通过CAS。只有观察到精确原快照才可重做未提交的同密码轮换。变成其他版本则报冲突，不能用旧资料覆盖新资料。关闭/锁定会清除待确认材料；如果服务端已经提交，新密码仍能解锁，此后可重新生成恢复码。确认之前保存新旧密码。

## 数据隔离与导入导出

云账户解密数据、待确认材料与使用中的DEK在client闭包内，没有账户明文 IndexedDB/localStorage/Cache API/outbox。可选浏览器自动解锁仅持久化下述包装key与加密DEK，不持久化密码、OPAQUE export secret、恢复码或账户明文。请求使用same-origin credentials、no-store、服务器确认owner的 `X-Dose-Owner`，AAD绑定同owner。profile、doses、scenarios、favorites、checkins、inventory整体加密。

访客默认只在内存；18岁声明后明确Remember才使用独立明文localStorage，账户登录不自动导入。Guest绿色Add只是校验并折叠simulated行，不写正式账户数据。本机SQLite与用户明确导出的CSV/JSON都是明文，不能称为云端密文。

登录或注册成功后，可以明确选择把当前游客模拟转入账户。`prepareGuestTransfer` 校验并复制 `{workspace,scenarioId}`，整个重试过程保留同一份输入。虚拟 POST `/guest-import` **不对应服务器明文端点**：客户端读取最新已确认密文，在本地解密合并，再通过原有 `/vault` CAS 一次上传完整密文。已有账户资料、正式记录、库存和症状均保留；profile 仅在账户原本为空时取游客偏好；收藏按精确产品与完整规格去重，保留账户原数量偏好；模拟剂量追加到已有 Workspace，或使用冻结的新 scenarioId 建立 Workspace。所有新增剂量仍为 simulated，使用本次传输命名空间的稳定新 ID，不能覆盖既有正式记录。未填完或不合法的游客输入整批拒绝，不丢弃个别行后声称完成。

首次发送或明确 CAS 失败后重试，读取最新账户快照再合并；不确定保存则保留原候选密文，只有精确匹配服务器确认才完成。稳定输入的重复确认不会追加第二份相同剂量；已转为正式记录的同 ID 不会恢复成模拟草稿。helper/client 从不删除浏览器存储。Gate 仅在成功确认后尝试清除同一设备、仍与事先捕获内容匹配的游客副本；其他标签页更新或存储不可访问时保留副本并提示。清理失败后只重试本机清理，不重复上传。取消、锁定或未确认上传均不授权删除游客原稿；已经提交但未收到确认的网络操作仍可能留在账户密文中。

`/export`读取当前已确认内存快照，不含密码、key或session。`/import`采用merge/replace，保留医学原始值/ID，再分配当前修订；文件读取前限制16MB，解析累计UTF8也受限。不能导入非空本机修订/删除历史后宣称云端保留全部审计链。Medication PDF 导出已按用户要求移除。

## 锁定和剩余边界

`lock()`同步清key/data/pending并中止Worker，默认撤销本浏览器自动解锁；Gate还必须卸载App及持有明文的组件。显式Hide、logout/logout-all与禁用设置撤销保存的key；logout在等待远端前先锁定，失败不能宣称远端注销成功。pagehide/unmount调用`lock({preserveAutoUnlock:true})`清内存，保留仍有效的自动解锁记录。关闭自动解锁后，下次刷新需要密码，但当前打开的记录不立即关闭。

打开的云账户使用7天idle上限与本次密码认证起算的固定绝对deadline，即使持续活动也不能延长；自动恢复沿用已保存deadline。focus/visibility及交互时补检，已开账户约60秒及聚焦时检查server session。服务端会话最长为建立起7天，不滑动续期；更短旧会话保留原到期时间。冻结/离线浏览器不能保证准点执行或确认远端撤销，不能远程抹除别人已读的内存或导出。

### 此浏览器自动解锁

注册/登录表单的显式checkbox默认开启，仅成功提交密码认证后调用`setAutoUnlockPreference(true)`；关闭checkbox不保存key。设置页可通过OPAQUE再次确认密码后启用，禁用无需重新输入密码。`getAutoUnlockPreference()`只返回enabled/expiry，`tryAutoUnlock()`不能把自动恢复当成新密码认证、不能续期。

`device-unlock.ts`使用专用IndexedDB数据库`dose-device-unlock`的`keys` store，按API base scope隔离。记录包含version/id/scope、公开revocation epoch、ownerId、规范化key-envelope的SHA-256 fingerprint、createdAt/expiresAt、non-extractable AES-256-GCM wrapping CryptoKey、随机IV和加密DEK。AAD绑定这些公开身份及期限字段。唯一配套localStorage值为`dose-device-unlock-revocation:<apiBase>`下的公开随机epoch；Hide/禁用/注销先同步更新墓碑，因此较晚的IDB写入或删除不能把旧key重新启用。此独立store的清理不触及本机版共享队列或访客模拟。

保存期限固定为显式成功密码认证时间+7天；访问、自动恢复与读取偏好均不能刷新期限。恢复前获取最新`/session`及`/vault`，检查owner、auth模式、包装fingerprint、期限/metadata；本地解密与领域schema验证通过后再次检查session及存储record仍有效，才发布明文。没有有效服务端session、不能取得新vault、包装发生变化或期限已过时不自动打开。较短/被撤销的server session优先。Hide、注销、切换账户、server401与密码/key安全变更撤销旧保存记录；过期/无效记录在读取时尝试清理，没有承诺定时物理删除。

服务器不接收上述本机wrapping key或DEK。浏览器非可导出CryptoKey只限制原始key导出API，不限制同源JS调用解密；可使用同一浏览器profile的人、恶意同源脚本或被控制的设备可能打开记录。不是硬件Secure Enclave或特定厂商安全级别的保证。

同一已开认证会话拒绝已见revision的回退，但刷新后没有独立可信最新状态锚点。网络请求没有统一deadline：永不结束的响应仍可阻塞认证串行队列，需重载恢复可用性；不能为了释放队列允许晚cookie覆盖新账户。该已知可用性边界没有被声称修复。

恶意同源脚本、运营者替换所供JS、依赖/扩展/设备被控制可读取输入和解锁数据。JavaScript/GC不保证物理清零。数据库仍能见账户标识、认证材料、访问时间和密文大小。详见[协议说明](./vault-crypto-design.md)。

## 验证

本轮真实OPAQUE原语7项、实际HTTP/临时SQLite组合客户端8项，以及新主密码规则与其余原语/客户端兼容67项，合计82/82通过（0失败/跳过）。组合测试包括fresh reauth、密码/恢复密钥轮换、错误恢复DEK、旧token与session撤销、CAS、丢响应、预提交失败及同主密码恢复重试、重复确认无第二次提交、晚结果锁定、注销/删除和正常协议不发原始秘密。服务端PG事务验证由服务器专项另记；没有碰真实用户库，也不将这些测试称为第三方审计或生产TLS验收。

后续可选游客转入专项新增6项纯合并、5项客户端并发/失败用例、1项真实OPAQUE登录+HTTP+临时SQLite链。覆盖原账户保留、精确规格、重复确认、已转正式记录不复活、无效输入与容量上限、断线前后同密文重试、CAS并发、锁定后不接受晚结果，以及网络/SQLite无游客明文。此批数量与上段历史82项有重叠，不应直接相加为一次完整测试结果。
