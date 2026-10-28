/**
 * MCP 自测：启动 server.mjs，走一遍 initialize / tools/list / status / eval / shutdown。
 * 运行：node tools/paiban-mcp/selftest.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.join(here, 'server.mjs')

const proc = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] })
let buffer = ''
const pending = new Map()
let nextId = 1

const waiters = []
proc.stdout.setEncoding('utf8')
proc.stdout.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      console.error('非 JSON-RPC 输出：', line.slice(0, 200))
      continue
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id)
      pending.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.id) {
      waiters.push(msg)
    }
  }
})
proc.stderr.setEncoding('utf8')
proc.stderr.on('data', (d) => {
  const text = d.toString().trim()
  if (text) console.error(`[server] ${text}`)
})
proc.on('exit', (code) => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(new Error(`MCP 进程退出，code=${code}`))
  }
  pending.clear()
})

function send(method, params, id = nextId++) {
  const msg = { jsonrpc: '2.0', id, method }
  if (params !== undefined) msg.params = params
  proc.stdin.write(JSON.stringify(msg) + '\n')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`等待 ${method} 超时`))
    }, 60000)
    pending.set(id, { resolve, reject, timer })
  })
}

function textOf(result) {
  return (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

try {
  console.log('→ initialize')
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'paiban-selftest', version: '1.0.0' },
  })
  assert(init.serverInfo?.name === 'paiban-mcp', 'serverInfo.name 不正确')
  assert(init.protocolVersion, '缺少 protocolVersion')
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  console.log('→ tools/list')
  const list = await send('tools/list', {})
  const toolNames = (list.tools ?? []).map((t) => t.name)
  console.log('  工具：', toolNames.join(', '))
  assert(toolNames.length >= 9, `工具数量不足：${toolNames.length}`)
  assert(toolNames.includes('paiban_status'), '缺少 paiban_status')
  assert(toolNames.includes('paiban_eval'), '缺少 paiban_eval')

  console.log('→ paiban_status')
  const status = await send('tools/call', { name: 'paiban_status', arguments: {} })
  const statusText = textOf(status)
  const statusJson = JSON.parse(statusText)
  assert(statusJson.pages >= 2, `页数异常：${statusJson.pages}`)
  assert(statusJson.total >= 20, `元素数异常：${statusJson.total}`)
  assert(statusJson.missingInDom === 0, '有元素不在 DOM')
  console.log('  页数/元素数：', statusJson.pages, '/', statusJson.total)

  console.log('→ paiban_eval')
  const evalRes = await send('tools/call', { name: 'paiban_eval', arguments: { expression: 'return { pages: api.doc.pages.length, w: api.doc.w }' } })
  const evalJson = JSON.parse(textOf(evalRes))
  assert(evalJson.ok === true, 'paiban_eval 返回 ok!=true')
  assert(evalJson.value?.pages >= 2, 'paiban_eval 结果不正确')

  console.log('→ shutdown')
  await send('shutdown', {})
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'exit' }) + '\n')
  await new Promise((r) => setTimeout(r, 300))
  console.log('✓ MCP 自测通过')
} catch (err) {
  console.error('✗ MCP 自测失败：', err.stack || err.message)
  process.exitCode = 1
} finally {
  try {
    proc.kill('SIGTERM')
  } catch {
    /* 忽略 */
  }
}
