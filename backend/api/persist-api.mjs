/**
 * SQLite 持久化 API（部署服务器与 Electron 桌面版共用）
 *
 * 提供 4 组端点，全部走同一个 http handler：
 * - GET  /api/health     探活（SQLite 不可用时返回 503，前端自动退回 localStorage）
 * - GET/PUT /api/doc     主存档（单值）
 * - GET/PUT /api/snapshots  快照列表（环形，只留最近 SNAP_LIMIT 份）
 * - GET/PUT /api/templates  模板库列表
 *
 * 零 npm 依赖：SQLite 用 Node 22 内置的 node:sqlite（Electron 38 内置 Node 22 同样可用）。
 * node:sqlite 加载失败时不抛错，只降级：health 返回 503，调用方按「无持久化」处理。
 */
import fs from 'node:fs'
import path from 'node:path'

const SNAP_LIMIT = 10
const MAX_BODY = 20 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function openDb(dbPath, DatabaseSync) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (
      at    INTEGER PRIMARY KEY,
      pages INTEGER NOT NULL,
      els   INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      raw   TEXT NOT NULL
    );
  `)
  return db
}

/**
 * @param {{ dbPath: string, log?: (msg: string) => void }} opts
 * @returns {Promise<{ handle: (req: import('http').IncomingMessage, res: import('http').ServerResponse, pathname: string) => Promise<boolean>, ok: boolean }>}
 *   handle() 返回 true 表示该请求已被处理（含 /api 404），false 表示不是 /api 路径。
 */
export async function createPersistApi({ dbPath, log = () => {} }) {
  let db = null
  try {
    const { DatabaseSync } = await import('node:sqlite')
    db = openDb(dbPath, DatabaseSync)
    log(`SQLite 就绪: ${dbPath}`)
  } catch (err) {
    log(`SQLite 不可用，持久化 API 已降级: ${err?.message || err}`)
  }

  /** @returns {Promise<boolean>} 是否处理了该请求 */
  const handle = async (req, res, pathname) => {
    if (!pathname.startsWith('/api/')) return false

    // 降级模式：让前端探活失败，自动退回纯 localStorage
    if (!db) {
      json(res, 503, { ok: false, error: 'sqlite unavailable' })
      return true
    }

    try {
      if (pathname === '/api/health') {
        json(res, 200, { ok: true })
        return true
      }

      /* ---- 主存档 ---- */
      if (pathname === '/api/doc') {
        if (req.method === 'GET') {
          const row = db.prepare('SELECT v FROM kv WHERE k = ?').get('doc')
          const at = db.prepare('SELECT v FROM kv WHERE k = ?').get('docAt')
          const push = db.prepare('SELECT v FROM kv WHERE k = ?').get('docPushedAt')
          // raw 保持原样给老前端用；at / pushedAt 供新前端判断「是否有外部推送的新稿」
          json(res, 200, {
            raw: row?.v ?? null,
            at: Number(at?.v ?? 0),
            pushedAt: Number(push?.v ?? 0),
          })
          return true
        }
        if (req.method === 'PUT') {
          const raw = await readBody(req)
          const now = Date.now()
          // ?push=1：由外部工具（排版 skill / 脚本）推送的新稿，前端要主动载入。
          // 不带这个参数的是编辑器自己的镜像写入，只更新时间戳，不触发载入。
          const isPush = /[?&]push=1\b/.test(req.url || '')
          const up = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
          up.run('doc', raw)
          up.run('docAt', String(now))
          if (isPush) up.run('docPushedAt', String(now))
          json(res, 200, { ok: true, at: now, pushedAt: isPush ? now : undefined })
          return true
        }
      }

      /* ---- 快照（环形，只留最近 SNAP_LIMIT 份） ---- */
      if (pathname === '/api/snapshots') {
        if (req.method === 'GET') {
          const rows = db.prepare('SELECT at, pages, els, bytes, raw FROM snapshots ORDER BY at DESC').all()
          json(res, 200, { v: 1, list: rows })
          return true
        }
        if (req.method === 'PUT') {
          const parsed = JSON.parse(await readBody(req))
          const list = Array.isArray(parsed) ? parsed : parsed?.list
          if (!Array.isArray(list)) {
            json(res, 400, { error: 'list required' })
            return true
          }
          const ins = db.prepare('INSERT OR REPLACE INTO snapshots (at, pages, els, bytes, raw) VALUES (?, ?, ?, ?, ?)')
          for (const s of list.slice(0, SNAP_LIMIT)) {
            ins.run(Number(s?.at) || Date.now(), Number(s?.pages) || 0, Number(s?.els) || 0, Number(s?.bytes) || 0, String(s?.raw ?? ''))
          }
          db.prepare('DELETE FROM snapshots WHERE at NOT IN (SELECT at FROM snapshots ORDER BY at DESC LIMIT ?)').run(SNAP_LIMIT)
          json(res, 200, { ok: true })
          return true
        }
      }

      /* ---- 模板库 ---- */
      if (pathname === '/api/templates') {
        if (req.method === 'GET') {
          const row = db.prepare('SELECT v FROM kv WHERE k = ?').get('templates')
          json(res, 200, { list: row ? JSON.parse(row.v) : [] })
          return true
        }
        if (req.method === 'PUT') {
          const list = JSON.parse(await readBody(req))
          if (!Array.isArray(list)) {
            json(res, 400, { error: 'list required' })
            return true
          }
          db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(
            'templates',
            JSON.stringify(list),
          )
          json(res, 200, { ok: true })
          return true
        }
      }

      json(res, 404, { error: 'not found' })
      return true
    } catch (err) {
      log(`API 失败 ${req.method} ${pathname}: ${err?.message || err}`)
      if (!res.headersSent) json(res, 500, { error: String(err?.message || err) })
      else res.end()
      return true
    }
  }

  return {
    handle,
    ok: Boolean(db),
    /**
     * 直接写主存档（给服务器端自动排版用）。
     * @param {string} raw doc JSON 字符串
     * @param {boolean} push true 表示外部推送，会更新 pushedAt，让前端下次打开自动载入
     */
    writeDoc(raw, push = false) {
      if (!db) return false
      const now = Date.now()
      const up = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      up.run('doc', raw)
      up.run('docAt', String(now))
      if (push) up.run('docPushedAt', String(now))
      return true
    },
  }
}
