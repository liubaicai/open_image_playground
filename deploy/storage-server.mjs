import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID, timingSafeEqual } from 'node:crypto'

const root = resolve(process.env.STORAGE_DATA_DIR || '/data')
const folders = { images: join(root, 'images'), thumbnails: join(root, 'thumbnails') }
for (const dir of [root, ...Object.values(folders)]) mkdirSync(dir, { recursive: true })
const statePath = join(root, 'state.json')
const empty = () => ({ revision: 0, kv: {}, tasks: {}, conversations: {}, images: {}, thumbnails: {} })
let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : empty()
for (const name of ['kv', 'tasks', 'conversations', 'images', 'thumbnails']) state[name] ??= {}
state.revision ??= 0
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/
const maxBody = Number(process.env.STORAGE_MAX_REQUEST_BYTES) || 200 * 1024 * 1024
const password = process.env.STORAGE_PASSWORD
if (!password || password.length < 12) throw new Error('必须设置至少 12 位的 STORAGE_PASSWORD，禁止无认证共享存储')
const username = process.env.STORAGE_USERNAME || 'admin'

function atomicWrite(file, content) {
  const tmp = file + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
  } finally {
    if (existsSync(tmp)) rmSync(tmp)
  }
}
function commit() {
  const prior = state.revision
  state.revision += 1
  try { atomicWrite(statePath, JSON.stringify(state)) } catch (error) { state.revision = prior; throw error }
}
function send(res, status, value) {
  const data = Buffer.from(JSON.stringify(value))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': data.length, 'x-content-type-options': 'nosniff' })
  res.end(data)
}
function bad(status, message) { const err = new Error(message); err.status = status; throw err }
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBody) bad(413, '请求超过存储大小限制')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return bad(400, 'JSON 格式不正确') }
}
function assertId(id) {
  if (!idPattern.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) bad(400, '无效的数据标识')
  return id
}
function storeRecord(collection, id, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.id !== id) bad(400, '数据标识不匹配')
  state[collection][id] = record
  commit()
}
function imageToFile(collection, id, dataUrl, record) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) bad(400, '无效的图片数据')
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)
  const binary = match && Buffer.from(match[2], 'base64')
  const canonical = binary && binary.toString('base64') === match[2]
  const bytes = canonical ? binary : Buffer.from(dataUrl, 'utf8')
  const metadata = { ...record, mime: canonical ? match[1] : '', raw: !canonical }
  delete metadata.dataUrl
  delete metadata.thumbnailDataUrl
  atomicWrite(join(folders[collection], id + '.bin'), bytes)
  state[collection][id] = metadata
  commit()
}
function readImage(collection, id) {
  const meta = state[collection][id]
  if (!meta) return null
  const file = join(folders[collection], id + '.bin')
  const bytes = readFileSync(file)
  const dataUrl = meta.raw ? bytes.toString('utf8') : 'data:' + meta.mime + ';base64,' + bytes.toString('base64')
  const { mime, raw, ...rest } = meta
  return { ...rest, [collection === 'images' ? 'dataUrl' : 'thumbnailDataUrl']: dataUrl }
}
function eraseImage(collection, id) {
  delete state[collection][id]
  rmSync(join(folders[collection], id + '.bin'), { force: true })
}
function replaceCollection(name, records) {
  if (!Array.isArray(records)) bad(400, '需要记录数组')
  const next = Object.create(null)
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) bad(400, '无效记录')
    const id = assertId(record.id)
    next[id] = record
  }
  state[name] = next
  commit()
}
function onlyAllowed(req, allowed) {
  if (!allowed.includes(req.method)) bad(405, '不支持的操作')
}
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname.split('/').filter(Boolean)
  if (path[0] !== 'storage-api') return send(res, 404, { error: 'Not found' })
  const basic = req.headers.authorization?.match(/^Basic (.+)$/i)
  let authorized = false
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const expected = username + ':' + password
    const a = Buffer.from(decoded)
    const b = Buffer.from(expected)
    authorized = a.length === b.length && timingSafeEqual(a, b)
  }
  if (!authorized) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Open Image Playground Shared Storage", charset="UTF-8"')
    return send(res, 401, { error: '需要存储访问认证' })
  }
  if (path.length === 2 && path[1] === 'health') {
    onlyAllowed(req, ['GET']); return send(res, 200, { ok: true })
  }
  if (path.length === 2 && path[1] === 'revision') {
    onlyAllowed(req, ['GET']); return send(res, 200, { revision: state.revision })
  }
  const name = path[1]
  if (!['kv', 'tasks', 'conversations', 'images', 'thumbnails'].includes(name)) bad(404, 'Not found')
  const id = path[2] && assertId(decodeURIComponent(path[2]))
  if (path.length === 2) {
    if (req.method === 'GET') {
      if (name === 'images' || name === 'thumbnails') return send(res, 200, Object.keys(state[name]))
      return send(res, 200, name === 'kv' ? state.kv : Object.values(state[name]))
    }
    onlyAllowed(req, ['DELETE'])
    if (name === 'kv') bad(405, '不允许清空全部设置')
    if (name === 'images' || name === 'thumbnails') {
      for (const key of Object.keys(state[name])) eraseImage(name, key)
      if (name === 'images') for (const key of Object.keys(state.thumbnails)) eraseImage('thumbnails', key)
    } else state[name] = Object.create(null)
    commit()
    return send(res, 200, { ok: true })
  }
  if (path.length === 3 && name === 'tasks' && path[2] === 'commit') {
    onlyAllowed(req, ['POST'])
    const { deletedTaskIds = [], updatedTasks = [], updatedConversations = [] } = await readBody(req)
    if (!Array.isArray(deletedTaskIds) || !Array.isArray(updatedTasks) || !Array.isArray(updatedConversations)) bad(400, '无效的批量变更')
    for (const id of deletedTaskIds) delete state.tasks[assertId(id)]
    for (const item of updatedTasks) { assertId(item.id); state.tasks[item.id] = item }
    for (const item of updatedConversations) { assertId(item.id); state.conversations[item.id] = item }
    commit(); return send(res, 200, { ok: true })
  }
  if (path.length === 3 && name === 'conversations' && path[2] === 'replace') {
    onlyAllowed(req, ['POST']); replaceCollection('conversations', (await readBody(req)).conversations)
    return send(res, 200, { ok: true })
  }
  if (path.length !== 3 || !id) bad(404, 'Not found')
  if (req.method === 'GET') {
    if (name === 'kv') bad(405, 'Read all settings instead')
    const value = name === 'images' || name === 'thumbnails' ? readImage(name, id) : state[name][id] ?? null
    return send(res, value === null ? 404 : 200, value === null ? { error: 'Not found' } : value)
  }
  if (req.method === 'DELETE') {
    if (name === 'images') { eraseImage('images', id); eraseImage('thumbnails', id) }
    else if (name === 'thumbnails') eraseImage('thumbnails', id)
    else delete state[name][id]
    commit(); return send(res, 200, { ok: true })
  }
  onlyAllowed(req, ['PUT'])
  const value = await readBody(req)
  if (name === 'kv') {
    if (typeof value.value !== 'string' || value.value.length > 16 * 1024 * 1024) bad(400, '无效配置')
    state.kv[id] = value.value
    commit()
  } else if (name === 'images' || name === 'thumbnails') {
    if (!value || value.id !== id) bad(400, '图片 ID 不匹配')
    imageToFile(name, id, value[name === 'images' ? 'dataUrl' : 'thumbnailDataUrl'], value)
  } else storeRecord(name, id, value)
  return send(res, 200, { ok: true })
}
const server = createServer((req, res) => {
  void handler(req, res).catch(err => {
    const status = err.status || 500
    if (status === 500) console.error('[storage]', err)
    if (!res.headersSent) send(res, status, { error: status === 500 ? '服务器存储发生错误' : err.message })
    else res.destroy()
  })
})
server.listen(Number(process.env.STORAGE_PORT) || 3001, '127.0.0.1', () => console.log('[storage] ready:', root))
