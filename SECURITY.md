# 安全说明

## 凭证怎么存

| 数据 | 位置 | 保护方式 |
|---|---|---|
| MiMo 登录 Cookie | `%APPDATA%\MiMoWhale\config.json` 的 `cookieDpapi` | **Windows DPAPI 加密**（当前用户作用域） |
| 余额 / 套餐数据 | `cache.json` | 本地明文缓存，不含凭证 |
| 会话用量 | 只读 `mimocode.db` | 不写入、不上传 |
| 界面偏好 | `settings.json` | 本地明文，不含凭证 |

### 加密细则

- 用 `CryptProtectData`（DPAPI，**不加** `CRYPTPROTECT_LOCAL_MACHINE`），密文只能被**同一台机器的同一个 Windows 用户**解开；
- 加密成功后，`config.json` 里的明文 `cookie` 字段会被清空，只留 `cookieDpapi`；
- **不支持悄悄降级成明文**：Windows 上如果 DPAPI 调用失败，保存会直接报错
  `ENCRYPT_FAILED`，宁愿不存也不落明文；确实要明文必须显式设置
  `MIMO_WHALE_ALLOW_PLAINTEXT=1`（非 Windows 的 CLI 场景会自动标记为 `no-dpapi`）；
- 诊断面板会显示当前存储方式：`DPAPI 加密` / `明文存储（不推荐）` / `未配置`；
- 从旧版升级时，旧 `whale.config.json` 里的明文 Cookie 会被迁移成加密值，
  **旧文件改名成 `.bak` 之前会先抹掉其中的凭证字段**（否则备份里仍躺着明文）。

### 不想落盘

用环境变量即可，完全不写文件：

```powershell
$env:MIMO_COOKIE = 'api-platform_serviceToken=...; userId=...'
```

读取优先级：`MIMO_COOKIE` > 加密配置 > 明文配置。

### DPAPI 防得住什么、防不住什么

- ✅ 别的 Windows 用户读不走（APPDATA 的 ACL 本身也只给当前用户 + SYSTEM + Administrators）；
- ✅ 把硬盘/文件拷到另一台电脑解不开（换机后需要重新填 Cookie——这是预期行为，不是 bug）；
- ✅ U 盘便携模式下数据跟着盘走，但密文在别的机器上无效；
- ❌ 不防"以当前用户身份运行的恶意程序"——它可以直接调用 DPAPI 解密。这是用户级加密的固有限制，不是实现缺陷。

## 网络行为

- 常规运行只访问 `https://platform.xiaomimimo.com`（余额 / 套餐 / 预警阈值），没有其它上报或统计；
- **唯一例外是你主动点"检查更新"**：那一次会请求 `https://api.github.com/repos/<owner>/<repo>/releases/latest`，
  只读版本号，不带 Cookie、不带设备标识；不点就不会发；
- 挂件不监听任何端口（旧版的本地 HTTP 预览服务已移除）。

## 关于"主密码"模式

有评审建议加一层用户主密码（用密码派生密钥加密 Cookie，而不是只依赖 DPAPI）。暂时没做，原因：

- 威胁模型是"以当前用户身份运行的恶意程序"。主密码能挡住"拷走文件"，但挡不住键盘记录、
  内存读取、以及注入到挂件进程里的代码——它只是把攻击点从 DPAPI 换成了"等用户输入密码"；
- 代价很实在：每次启动都要输密码（桌宠这种高频小工具体验很差）、忘记密码等于丢 Cookie、
  还要多一套解锁状态机与重试逻辑；
- 如果你确实需要（例如共享电脑），更合适的做法是用环境变量 `MIMO_COOKIE` 从外部注入，
  **完全不落盘**——这是目前就支持的用法。

将来若要加，正确形态是：DPAPI + 密码派生密钥双层加密；密码只经 stdin 传给 sidecar；
并提供"忘记密码 = 重新登录"的退路。

## 请不要提交

`config.json`、`settings.json`、`cache.json`、`ledger.json`、`logs/`、任何 `.lnk`。
`.gitignore` 已覆盖，但提交前仍请 `git status` 检查一遍。

## 报告漏洞

请**不要**开公开 issue。用 GitHub 的 Security Advisory（仓库 → Security → Report a vulnerability），
或在 issue 里只描述问题、不贴凭证。48 小时内会有人回复。

如果泄露了 Cookie：立刻到控制台重新登录，旧 Cookie 会失效。
