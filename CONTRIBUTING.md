# 参与贡献

欢迎 issue 和 PR。这个项目的目标很小：**一个开箱即用、读得懂、改得动的桌面挂件**。
所以比起新功能，更看重"边界清晰 + 有测试 + 不引入多余依赖"。

> 第一次参与（人或 AI）：先读 [docs/HANDOFF.md](docs/HANDOFF.md)。
> 里面有 17 条"动了就出事"的红线，以及那些看起来奇怪、其实是有意为之的写法。

## 本地开发

```bat
git clone <repo>
cd <repo>

setup.cmd -InstallDeps   :: 下载 Electron（需要 Node.js 18+）
npm start                :: 启动挂件

npm test                 :: Node 单测
npm run test:py          :: Python 单测
npm run lint             :: 语法检查
npm run smoke            :: 真正启动一次 Electron 自检
npm run package          :: 打出自带运行时的便携包（release/）
```

Python 单测不需要网络、不需要真实 MiMo 安装、也不需要 Node 依赖。

## 日常更新流程（改完代码怎么推到 GitHub）

```bat
git status                    :: 看改了什么；这里不该出现 node_modules/ .tmp/ config.json
npm run lint && npm test && npm run test:py

git add -A
git commit -m "fix: 菜单按钮没绑定事件"
git pull --rebase             :: 远端有别人的提交时先合，避免被拒
git push
```

**被拒绝（non-fast-forward）**：说明远端比你新，先 `git pull --rebase` 再 push。
出现冲突就打开文件改掉 `<<<<<<<` 那几行，然后：

```bat
git add <冲突文件>
git rebase --continue
git push
```

**发新版**（版本号必须三处同步，测试会断言）：

1. `package.json` 的 `version`；
2. `python/whale/__init__.py` 的 `__version__`；
3. `npm run package` 打出 `release\MiMo-Balance-Widget-<版本>-win-x64.zip`。

```bat
git commit -am "chore: 版本 0.1.1"
git tag -a v0.1.1 -m "v0.1.1"
git push
git push origin v0.1.1
```

然后到 GitHub → Releases → 选该 tag → 上传 zip。

**绝不能提交**：`config.json`、`settings.json`、`node_modules/`、`.tmp*`、`*.log`、`release/`。
如果不小心提交了 `config.json` 并已 push：先 `git rm --cached config.json` 再提交，
**但 Cookie 必须重新生成**——它已经进入 git 历史，删掉文件也清除不掉。

## 代码约定

### 目录职责

| 目录 | 可以做什么 | 不要做什么 |
|---|---|---|
| `app/main.js` | 编排、启动顺序 | 写业务逻辑 |
| `app/lib/` | 单一职责的模块（窗口、设置、日志、sidecar…） | 互相 require 成环 |
| `app/src/` | 只画界面 | 读写文件、发网络请求 |
| `app/shared/` | 纯函数，主进程与渲染层共用 | 引入 Electron / DOM 依赖 |
| `python/whale/` | 数据层，只用标准库 | 引入第三方包 |

### 硬性规则

1. **渲染层不碰 Node**：需要新能力就加 preload 方法 + IPC handler + `validate.js` 校验。
2. **不留 `innerHTML`**：用 `el()` / `textContent`。
3. **不加 `!important`**（`[hidden]` 除外）：用 CSS 变量或提高选择器精度解决。
4. **配置只由一个进程写**：`config.json` 归 Python，`settings.json` 归 Electron。
5. **错误统一成 `WhaleError(code, message)`**，前端按 `code` 判断，按 `message` 展示。
6. **新增依赖要先讨论**：数据层必须保持零第三方依赖；前端不引入框架。

### 新增一个数据字段的完整流程

1. `python/whale/api.py`（或 `sessions.py`）产出字段；
2. `python/whale/summary.py` 把它放进快照，必要时 bump `SCHEMA`；
3. `docs/ARCHITECTURE.md` 更新快照示例；
4. `app/src/js/panel.js` 渲染它；
5. `python/tests/` 与 `test/` 各补一个断言。

### 提交信息

用 `type: 摘要` 的形式，一行说清"做了什么"：

```text
fix: 管道下 Python 输出改为强制 UTF-8
feat: 支持锁定统计会话
docs: 补充移动目录后的自启修复说明
```

## PR 检查清单

- [ ] `npm test` 与 `npm run test:py` 全绿
- [ ] `npm run lint` 通过
- [ ] 涉及界面的改动自己跑过 `npm start`
- [ ] 没有提交 `config.json` / `settings.json` / 任何 Cookie
- [ ] 文档（README / TROUBLESHOOTING / ARCHITECTURE）同步更新

## 报告问题

请附上：系统版本、Node / Python 版本、`whale.cmd diagnose` 的输出（已脱敏）、
`logs\app.log` 的相关片段。**不要粘贴 Cookie。**
