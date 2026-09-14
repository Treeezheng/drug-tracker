# 客户端保险箱加密模块：协议、接口与边界

核对日期：2026-09-13。`src/lib/vault-crypto.ts` 最初作为独立原语模块交付，随后由独立云版的 cloud-client / CloudGate 接入加密账户流程；本机版未改成加密数据库，访客 localStorage 草稿也未加密。本文件只描述原语协议与专项测试，不能据此声称整个网站的所有数据均已端到端加密、通过安全审计或符合某项医疗合规标准。当前集成状态见 [版本与加密边界](./editions-and-encryption.md)。

## 密码学选择与依据

- 数据密钥（DEK / vault key）通过 Web Crypto `generateKey` 生成随机 AES-256-GCM 密钥。采用平台实现，没有自行实现 AES 或随机算法。[MDN AES 密钥参数](https://developer.mozilla.org/en-US/docs/Web/API/AesKeyGenParams)、[OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- 每次加密数据、每次包裹密钥都重新生成 12 字节（96 位）随机 IV / nonce，使用 128 位 GCM tag。IV 可公开，但同一密钥下不能复用来加密新明文。[MDN AesGcmParams](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams)
- 独立的客户端 vault passphrase 经 PBKDF2-HMAC-SHA-256、随机 16 字节 salt、默认 600,000 次迭代，派生不可导出的 AES-256-GCM KEK，用平台 `wrapKey` / `unwrapKey` 包裹随机 DEK。这里采用 OWASP 列出的 PBKDF2 工作量基线；这不是把 PBKDF2 描述为其所有场景的首选算法，也不是 FIPS 认证声明。[OWASP Password Storage：PBKDF2](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2)、[MDN deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)、[MDN wrapKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/wrapKey)
- 口令必须由客户端独立收集。**登录密码不能作为 vault passphrase，也不能调用服务器来派生或恢复 DEK。** 本模块既不读取登录信息，也不包含任何网络、存储、剪贴板或 URL 操作；调用方必须维持这种分离。客户端没有此前登录密码时，不能声称总能检测密码是否重复。

新口令的实现限制为至少 12 个 Unicode 字符、最多 1,024 个 UTF-16 code units，不要求特定字符组合，也不执行 trim、Unicode normalization 或截断。长度下限不等于足够的抗猜测强度；未来 UI 应引导使用较长、独立的随机口令。PBKDF2 只能提高每次猜测的成本，不能消除服务器密文泄露后的离线猜测。解锁时只接受 600,000–2,000,000 的整数迭代次数；上限用于拒绝不受控的高成本信封，并不防止恶意脚本连续发起大量操作。

## 函数接口

```ts
createVaultKey(): Promise<CryptoKey>
exportRecoveryKey(key: CryptoKey): Promise<string>
importRecoveryKey(recoveryKey: string): Promise<CryptoKey>

encryptVault(data: AppData, key: CryptoKey, ownerId: string): Promise<VaultDataEnvelope>
decryptVault(envelope: unknown, key: CryptoKey, expectedOwnerId: string): Promise<AppData>

wrapVaultKey(key: CryptoKey, vaultPassphrase: string, ownerId: string): Promise<VaultKeyEnvelope>
unwrapVaultKey(envelope: unknown, vaultPassphrase: string, expectedOwnerId: string): Promise<CryptoKey>
```

`expectedOwnerId` 必须来自调用方已确认的稳定账户 ID，不能从收到的信封抄回函数参数。ID 限定为 1–128 个 ASCII 字母、数字、下划线或连字符；不用邮箱或可修改显示名称作为绑定依据。

`decryptVault`、`unwrapVaultKey`、`importRecoveryKey` 对格式不符、错误密钥、口令不符、认证 tag 失败、账户不符等统一抛出 `VaultDecryptionError`，消息为 `Unable to unlock this encrypted vault.`，不返回内部异常原因。统一文字不是所有失败路径的恒定时间保证；格式检查会在高成本 KDF 之前失败。

## 精确信封格式

```ts
type VaultDataEnvelope = {
  protocol: 'dose-timeline-vault';
  version: 1;
  kind: 'data';
  ownerId: string;
  cipher: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
};

type VaultKeyEnvelope = {
  protocol: 'dose-timeline-vault';
  version: 1;
  kind: 'wrapped-key';
  ownerId: string;
  cipher: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
};
```

二进制字段只接受无 `=` padding 的 canonical base64url；不能含空白、标准 base64 的 `+` / `/`，或非零未使用 pad bits。每层对象采用精确字段白名单，不接受额外字段、未知协议版本或替换算法。

| 字段 | 限制 |
| --- | --- |
| `iv` | 12 字节，编码后 16 字符 |
| `kdf.salt` | 16 字节，编码后 22 字符 |
| wrapped-key `ciphertext` | 48 字节，编码后 64 字符，含 32 字节 DEK 与 16 字节 tag |
| data `ciphertext` | 17–16,000,016 字节，含 tag；合法 AppData 的实际最小长度更大 |
| 解密前的 UTF-8 明文 | 不超过 16,000,000 字节 |
| JSON 结构 | 深度不超过 32；遍历不超过 500,000 个值；单数组不超过 50,000 项；单对象不超过 100 字段；单字符串不超过 1,000,000 UTF-16 code units |

加密前在遍历输入时累计最终 JSON 的准确 UTF-8 字节预算，包括键名、引号、逗号、冒号、括号、数字，以及控制字符/引号/反斜杠/孤立 surrogate 的 JSON 转义。超过 16 MB 即停止，不先拼接巨型 JSON，也不为每段字符串额外生成转义副本或 UTF-8 byte array。完成后的整体编码仍保留最终字节检查。

数据明文是单个 `AppData` JSON，包含 profile、doses、scenarios、favorites、checkins 和 inventory。旧数据没有 inventory 时保留其缺省状态。所有这些集合的数据一起加密，不在信封外单独存储药名、剂量、症状、备注或时区。可选对象属性 `undefined` 按标准 JSON 语义省略；数组不静默丢值。循环引用、非有限数、非普通对象和 `__proto__` / `constructor` / `prototype` 字段被拒绝。

本模块只验证安全的 JSON / 集合结构，**不代替应用的药物、时间、revision、ID 和备份语义校验**。未来恢复流程必须在将解密结果应用到状态前调用完整的应用 schema 校验。认证 tag 成功只表明密钥与认证数据匹配，不证明药量或医学模型正确。

## AAD 与账户绑定

AAD 为以下有序数组 `JSON.stringify` 后的 UTF-8 字节：

```ts
// 数据
['dose-timeline-vault', 1, 'data', 'AES-256-GCM', expectedOwnerId]

// 包裹密钥
['dose-timeline-vault', 1, 'wrapped-key', 'AES-256-GCM', expectedOwnerId,
 'PBKDF2', 'SHA-256', iterations, salt]
```

这使协议版本、数据/密钥用途、cipher、账户及完整 KDF metadata 受认证约束；修改信封 ownerId 并同时将另一账户作为 expectedOwnerId 仍会解密失败。`additionalData` 必须在加解密时完全一致，这是平台 GCM 认证接口的一部分。[MDN AesGcmParams：additionalData](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams#additionaldata)

当前前提是**每个 owner 一个完整 AppData blob**，因此没有逐条 dose record 的交换目标。以后若改成多 vault 或逐条加密，必须升级协议并将稳定 vault ID / record ID / key epoch 纳入 AAD，不能直接沿用 v1。

## 恢复码与密钥生命周期

1. 建立 vault 时在客户端生成随机 DEK。使用独立 vault passphrase 生成包装信封；存储层最多接收包装信封和数据密文。
2. 恢复码是 DEK 原始 32 字节的 base64url 表示，长度 43 字符。**它本身就是完整解密密钥**，并不是登录恢复码、额外随机验证令牌或另一个服务器验证凭据。拥有恢复码和相应密文即可解密，不能上传到服务器、日志、埋点、URL、localStorage 或常规 IndexedDB 明文状态。
3. 解锁时只在客户端内存持有 vault passphrase、KEK、DEK 和解密后的数据。KEK 不可导出；DEK 可导出是显式密钥包装及恢复码备份所需。恢复码显示和用户主动离线备份属于未来 UI 集成，本模块不自动触碰剪贴板或下载文件。
4. 锁定、退出或切换账户时，调用方应清空 UI 表单和所有持有密钥/明文的状态引用。模块对自己控制的临时 byte arrays 尽力 `fill(0)`；JavaScript 字符串、浏览器内部密钥及垃圾回收副本无法保证立即或可靠清零。不能声称这是硬件隔离或内存取证防护。[W3C Web Cryptography：Security considerations](https://www.w3.org/TR/webcrypto/#security-considerations)
5. 修改 vault passphrase 可以重新包裹同一 DEK，不必重加密全部数据。**旧的 wrapped-key 副本仍能用旧口令解开同一 DEK**；真正处理密钥泄露需要生成新 DEK、重新加密当前 vault，并发放新的恢复码。即使轮换，也不能撤销攻击者已经保存的旧密钥与旧密文。
6. 忘记 vault passphrase 时，离线恢复码可以导入 DEK，再用新口令包装。仅重置登录密码不会解密 vault。如果独立口令与恢复码都丢失，模块没有服务器后门恢复路径。

随机 96 位 nonce 方案存在极小但非零的碰撞概率。每次新的加密操作（包括重新计算的重试）都生成新 nonce；网络重试可以发送已有的**完全相同信封**，不能拿旧 nonce 加密变化后的内容。模块没有跨设备持久加密次数计数；未来部署需设置合理的密钥轮换策略，不能把单个密钥用于无界数量的加密操作。[MDN GCM IV 要求](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams#iv)

## 不在本模块防护范围内

- 主动恶意服务器仍可替换它提供的网页 JavaScript，在用户输入独立口令、展示恢复码或解锁数据时窃取它们。XSS、被控制的依赖/构建链、具有页面权限的浏览器扩展、被控制的终端也有类似能力。Web Crypto 不把任意同源恶意脚本隔离在密钥之外。[W3C Security considerations](https://www.w3.org/TR/webcrypto/#security-considerations)
- AES-GCM 不检测合法旧密文的回滚。普通 CAS revision 可防常见并发覆盖，但不能证明恶意服务器没有返回旧快照。v1 没有可信最新版本锚点、透明日志或可信 monotonic counter。
- 删除、拒绝服务、密文长度、读写时间、稳定账户标识等元数据不被隐藏；未来仍需 HTTPS、账户隔离、访问控制、限流、备份、迁移和冲突处理。
- 手机通过普通局域网 HTTP 访问时可能不具备 Web Crypto 的 secure context。未来接入前必须验证 HTTPS / 浏览器支持和实际 iPhone 运行环境，不能用桌面 Node 测试代替。[MDN deriveKey：Secure context](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- 当前数据库已有的明文、导出文件、日志与备份不会因添加模块自动被加密或删除。真正启用前需要明确迁移和回退策略。

## 已完成测试

`node --import tsx --test tests/vault-crypto.test.ts`：**15 项通过，0 失败**，运行环境为本机 Node 24 Web Crypto。

覆盖随机 256 位密钥、canonical 恢复码导入导出、所有 AppData 集合与中文/emoji、精确小数量和 revision、并发加密的新 nonce、原生 Web Crypto 独立 AAD 解密验证、错误密钥/口令、ciphertext/tag/IV 篡改、修改 ownerId 后的密码学绑定、用途替换、KDF 降级与过高工作量、长度与字段限制、密钥重新包装、Unicode 无隐式归一化、JSON 深度/大小/危险字段，以及经过认证但内容非法的明文。

额外回归验证两项加密前内存边界：200 个条目共享同一个 1 MB 备注时，在进入根对象 `JSON.stringify` 前即拒绝；含中文、emoji、控制字符、转义键名、孤立 surrogate 和多种 primitive 的边界数据，准确允许 16,000,000 字节，并在多一个字节时提前拒绝。测试拦截根序列化，不实际构造 200 MB JSON。该检查修复了快速复核发现的“累计大小检查晚于巨型字符串分配”问题。

随机 nonce 的有限样本测试不证明数学上永不碰撞。本次还有另一代理只读快速审阅协议与源码，未发现阻塞性算法使用问题；这不是正式独立安全审计，也不是完整端到端加密产品验收。
