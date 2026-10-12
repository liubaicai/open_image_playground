import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shared storage authenticates and survives restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'image-playground-'))
  const port = 32000 + Math.floor(Math.random() * 10000)
  const base = 'http://127.0.0.1:' + port + '/storage-api/'
  const headers = { authorization: 'Basic ' + Buffer.from('admin:test-password-123').toString('base64'), 'content-type': 'application/json' }
  const launch = async () => {
    const childProcess = spawn(process.execPath, ['deploy/storage-server.mjs'], { env: { ...globalThis.process.env, STORAGE_DATA_DIR: root, STORAGE_PORT: String(port), STORAGE_PASSWORD: 'test-password-123' } })
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + 'revision', { headers })).ok) return childProcess
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('server did not start')
  }
  const send = (path, method = 'GET', data) => fetch(base + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) })
  let child
  try {
    child = await launch()
    assert.equal((await fetch(base + 'kv')).status, 401)
    assert.equal((await send('kv/gpt-image-playground', 'PUT', { value: 'persisted' })).status, 200)
    assert.equal((await send('images/abc', 'PUT', { id: 'abc', dataUrl: 'data:image/png;base64,YQ==' })).status, 200)
    child.kill()
    await new Promise(resolve => child.once('exit', resolve))
    child = await launch()
    assert.equal((await (await send('kv')).json())['gpt-image-playground'], 'persisted')
    assert.equal((await (await send('images/abc')).json()).dataUrl, 'data:image/png;base64,YQ==')
  } finally {
    child?.kill()
    rmSync(root, { recursive: true, force: true })
  }
})
