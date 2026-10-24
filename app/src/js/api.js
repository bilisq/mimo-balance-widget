/**
 * 预加载接口的薄封装。
 *
 * 好处有两个：
 * 1. 页面在浏览器里直接打开时给出清晰报错，而不是一串 undefined；
 * 2. 渲染层代码只依赖这里的形状，主进程改通道名时只改一处。
 */

/**
 * 数据契约（与 python/whale/summary.py 的 SCHEMA 版本绑定）。
 * 没有 TypeScript，但至少让编辑器能提示字段名——字段改名时漏改渲染层是真实风险。
 *
 * @typedef {Object} Balance
 * @property {number} amount
 * @property {number|null} cash
 * @property {number|null} gift
 * @property {string} currency
 * @property {string} queriedAt
 *
 * @typedef {Object} TokenPlan
 * @property {boolean} hasPlan
 * @property {string} planCode
 * @property {boolean} expired
 * @property {string|null} periodEnd
 * @property {number} used
 * @property {number} limit
 * @property {number} percent
 * @property {string} itemName
 *
 * @typedef {Object} SessionTokens
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [message]
 * @property {string} sessionId
 * @property {number} steps
 * @property {{billed:number,input:number,output:number,reasoning:number,contextLast:number}} tokens
 * @property {{read:number,write:number,hitRate:number|null}} cache
 * @property {number} cost
 *
 * @typedef {Object} LastTurn
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} endedAt
 * @property {number} startAt
 * @property {number} turn
 * @property {number} steps
 * @property {number} tokPerSec
 * @property {number} billed
 * @property {number} output
 * @property {number} cost
 *
 * @typedef {Object} AlertConfig
 * @property {boolean} ok
 * @property {boolean} enabled
 * @property {number|null} threshold
 *
 * @typedef {Object} Snapshot
 * @property {2} schema
 * @property {boolean} ok
 * @property {"api"|"cache"|"none"} source
 * @property {boolean} stale
 * @property {number|null} cacheAgeSeconds
 * @property {{code:string,message:string}|null} error
 * @property {Balance|null} balance
 * @property {TokenPlan|null} tokenPlan
 * @property {{today:number,week7:number,days:Record<string,number>,updated:string|null}|null} ledger
 * @property {SessionTokens|null} sessionTokens
 * @property {LastTurn|null} lastTurn
 * @property {AlertConfig|null} alertConfig
 * @property {string|null} generatedAt
 * @property {number} refreshSeconds
 *
 * @typedef {Object} Settings
 * @property {number} scale
 * @property {"xiaomi"|"xiaoai"|"whale"} presetId
 * @property {string|null} customImage
 * @property {boolean} speechEnabled
 * @property {string[]} speechLines
 * @property {"auto"|"custom"} toastMode
 * @property {{text:string,fill:string,stroke:string}} toastColors
 * @property {{plan:boolean,sessionTokens:boolean,cacheHit:boolean,context:boolean,turn:boolean}} display
 * @property {number|null} balanceWarn
 * @property {string|null} sessionId
 * @property {"auto"|"light"|"dark"} theme
 * @property {{x:number,y:number}|null} window
 */

const bridge = typeof window !== 'undefined' ? window.whale : null;

export const available = !!bridge;

function need() {
  if (!bridge) throw new Error('未注入 whale 接口：请用 npm start 启动，而不是直接打开 index.html');
  return bridge;
}

export const api = {
  info: () => need().info(),

  settings: {
    get: () => need().settings.get(),
    save: (patch) => need().settings.save(patch),
  },

  cookie: {
    save: (value) => need().cookie.save(value),
  },

  petImage: {
    get: () => need().petImage.get(),
    save: (payload) => need().petImage.save(payload),
    reset: () => need().petImage.reset(),
  },

  sessions: {
    list: () => need().sessions.list(),
    pin: (id) => need().sessions.pin(id),
  },

  data: {
    /** @returns {Promise<Snapshot>} 只读缓存 + 现算本地数据，不联网 */
    snapshot: () => need().data.snapshot(),
    /** @returns {Promise<Snapshot>} 联网刷新；失败时返回带 error 的缓存快照 */
    refresh: () => need().data.refresh(),
  },

  theme: {
    get: () => need().theme.get(),
  },

  autostart: {
    get: () => need().autostart.get(),
    set: (enabled) => need().autostart.set(enabled),
  },

  diagnostics: () => need().diagnostics(),

  open: (target) => need().open(target),

  window: {
    geometry: () => need().window.geometry(),
    move: (point) => need().window.move(point),
    snap: () => need().window.snap(),
  },

  hide: () => need().hide(),
  quit: () => need().quit(),

  on: {
    snapshot: (handler) => need().on.snapshot(handler),
    probe: (handler) => need().on.probe(handler),
    theme: (handler) => need().on.theme(handler),
    status: (handler) => need().on.status(handler),
    settings: (handler) => need().on.settings(handler),
    menu: (handler) => need().on.menu(handler),
  },
};
