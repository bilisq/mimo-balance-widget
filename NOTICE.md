# NOTICE

## 许可拆分

| 内容 | 许可 |
|---|---|
| 源代码（`app/`、`python/`、`scripts/`、`skill/`、`test/`） | MIT（见 [LICENSE](LICENSE)） |
| 默认鲸鱼图 `app/assets/whale-tight.png` | MIT |
| `artwork-nc/` 下的角色皮肤 | **CC BY-NC-SA 4.0（非商用）** |

MIT 只覆盖代码。把 MIT 代码和 `artwork-nc/` 的图片一起分发时，图片部分仍受非商用条款约束。

## 角色皮肤（`artwork-nc/`）

- 许可：CC BY-NC-SA 4.0 — <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- 允许：非商业用途的复制、修改、再分发，需署名并以相同条款共享
- 不允许：售卖、付费产品、广告变现
- 部分形象可能涉及第三方 IP（如品牌吉祥物），**即使你的改图采用 BY-NC-SA，
  底层角色的权利仍归原权利人**，商用前请自行确认
- 仓库内图片为 720px 优化版（旧版的原始尺寸版本未包含在本仓库）

## 代码来源

- 本项目 0.1.0 的界面与交互部分参考了
  [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)
  （MIT, Copyright (c) 2026 MeteorNOX），并按 MIT 条款保留署名。
- 0.1.0 的数据层、主进程、渲染层结构为重写版本。

## 数据来源

- 余额与套餐来自 `platform.xiaomimimo.com` 的**非官方**控制台接口，需要登录 Cookie；
- 会话用量来自 MiMo 桌面端本地轨迹库 `mimocode.db`（只读）；
- 本项目与小米无任何隶属或背书关系，请自行评估接口使用风险并遵守服务条款。
