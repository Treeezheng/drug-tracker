# 访客与注册账户交叉审查

2026-09-13。只读审查新 `GuestSimulator.tsx`、`guest-workspace.ts`、`CloudGate.tsx`、`cloud-client.ts` 的注册增量，以及 `server/cloud.mjs` 多账户与迁移增量。实现由其他代理负责，本次独立核对并复跑测试。没有打开、修改、迁移或上传用户的实际数据库；以下结果也不等于已上线或外部安全审计。

## 已核对的边界

- **默认访客不查会话、不请求账户 API。** Gate 初始为 guest；只有用户明确点击 Sign in 才调用 session。Guest 不引用账户 API/云客户端，图表的 actual 输入为空，新增、修改、拖动和复制行均为 simulated。Taken、History 只打开登录入口。
- **没有隐式迁移。** 注册请求只有 username/password 和可选 name。Gate 使用 `setupVault(secret)`，不传 guest 或本机 initialData。成功解锁时 App 与 Guest 互斥；回到访客重新读取其原本的独立浏览器草稿，不从账户复制记录或收藏。
- **访客存储为明文。** 固定 versioned localStorage key 仅接受模拟草稿、收藏和演算偏好；拒绝 actual/planned/skipped、账号、症状、库存、会话、密钥、正式修订等字段。坏数据不自动覆盖；容量或访问失败显示仅内存提示；Clear simulation 只删除访客 key，保留无关存储。
- **账户数据仍在上传前加密。** cloud mode 在入口固定，关闭 transport 不会回退到本机 IndexedDB/outbox。注册先丢弃旧 key/data，再接受新 owner；异步响应的 generation 检查拒绝已经关闭的注册流程。锁定与退出立即卸载 App；网络注销失败不恢复明文界面，也不声称服务器会话已撤销。
- **服务器按稳定 owner 隔离。** 新账户得到独立随机 ID；会话决定 owner，vault 还要求匹配的 owner header，AAD 也绑定 owner。新注册不会建立任何健康明文行或自动 seed vault。v1→v2 保留旧 owner/hash/session/vault；失败回滚。原 bootstrap 账户没有额外管理员权限。

上述路径未发现自动上传或访客生成正式服药记录。最后一轮其他代理交叉检查另发现两项账户切换边界，现已修复并复核：owner 不匹配原为普通 409，未触发 Gate 卸载旧记录；取消认证后立刻再次认证，generation 虽阻止旧 JS 回写，却不能阻止浏览器接受迟到的 Set-Cookie。后端现在把账号变更与 CAS 冲突区分为 401 / 409；Gate 捕获打开时的 owner，session 返回另一账号或收到 401 时卸载。客户端用独立 authQueue 将登录、注册、退出的整个网络操作串行，session 等待先前认证；Browse/lock 清除明文，但不释放尚未完成的认证网络队列。专项测试确认迟到注册/退出不能覆盖随后请求的会话、取消的排队认证不会发出。跨标签页仍依赖服务端 owner 检查和发现变更后锁定，不声称跨标签页 cookie 被全局串行。当前未发现其他具体阻塞项；这不是对任意扩展、恶意服务器或真实设备的安全保证。

## 文案修正

同步了 README、PRIVACY、发布的 `public/privacy.html`、版本说明、云 API/客户端/原语说明与 VM 部署验收步骤。删除当前版本中的“无公开注册 / single-owner”旧保证；原有交叉审查报告明确标为加入注册前的历史结果。账户 E2EE 不扩张为访客 localStorage 加密；账号、用户名、会话与连接元数据仍由服务端可见。

公开注册不验证身份或邮箱，重复用户名响应可暴露存在性；当前没有自助账号密码重置或云账号删除。登录为全服务 30 次/15 分钟，注册为独立的全服务 10 次/小时，共享最多两个散列任务；其他人可消耗此额度，进程重启会重置计数。账户名和这些限制不能被描述为抗滥用或身份核验体系。

页面拿到解锁后的数据即具有明文。源站仍能更换 JavaScript，根站与 `/drug` 共享 origin，扩展或受控设备也可能读取数据；开源和 AES-GCM 不消除这些边界。服务端会话在闲置时过期，不会立即通知仍打开的页面；检测到过期或主动锁定时才执行清理。JS 清除引用不等于物理内存擦除。

## 独立执行的验证

- `tests/guest-workspace.test.ts`：6/6，通过真实自定义规格/数量往返、状态及账号字段隔离、坏存储保留、拒绝容量越界与跳过的本地日期。
- `tests/cloud-registration-client.test.ts`：6/6，通过仅认证字段、空新 vault、旧 key 清除、重复注册失败、关闭后迟到响应、认证/注销串行和 session 等待。
- `tests/cloud-client.test.ts`：24/24，通过原有完整集合/备注/单位、并发 CAS、错误确认重试、锁定、离线退出和导入修订。
- `tests/cloud-api.test.mjs` + `tests/vault-store.test.mjs`：22/22，通过公开注册隔离、重名竞争、拒绝额外密钥字段、限流、多 worker 迁移/回滚，以及真实加密 envelope 存储。首次受沙箱 loopback 限制；允许合成测试使用临时本地端口后重跑全部通过。

共 58 项，均使用内存模拟传输或临时合成数据库。根代理另行负责浏览器布局、点击流程与注册→加密设置→锁定/退出的实际 UI 验收；本报告没有把那部分称作自己完成的测试。
