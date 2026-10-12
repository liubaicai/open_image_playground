import type { StateStorage } from 'zustand/middleware'
import { isTauri } from './platform'
import { readRuntimeEnv } from './runtimeEnv'

// Docker 在容器启动时注入标记，避免构建器提前把占位符比较折叠成 false。
export const isDockerSharedStorage = !isTauri && readRuntimeEnv(import.meta.env.VITE_DOCKER_DEPLOYMENT) === 'true'

const cache = new Map<string, string>()
let queue: Promise<unknown> = Promise.resolve()
let lastWritten: string | undefined
const KEY = 'gpt-image-playground'

function enqueue(value: string) {
  if (value === lastWritten) return
  lastWritten = value
  queue = queue.catch(() => {}).then(async () => {
    const response = await fetch('/storage-api/kv/' + KEY, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    if (!response.ok) throw new Error('服务端配置保存失败 (' + response.status + ')')
  })
  void queue.catch(error => console.error(error))
}

export async function preloadDockerStorage() {
  if (!isDockerSharedStorage) return
  const response = await fetch('/storage-api/kv', { cache: 'no-store' })
  if (!response.ok) throw new Error('无法读取服务端配置 (' + response.status + ')')
  const values = await response.json() as Record<string, string>
  const value = values[KEY]
  if (typeof value === 'string') {
    cache.set(KEY, value)
    lastWritten = value
  }
}

/** Return true only when a remote browser changed shared configuration. */
export async function reloadDockerStorage(): Promise<boolean> {
  await queue
  const response = await fetch('/storage-api/kv', { cache: 'no-store' })
  if (!response.ok) throw new Error('读取共享配置失败 (' + response.status + ')')
  const values = await response.json() as Record<string, string>
  const remote = values[KEY]
  if (typeof remote !== 'string' || remote === cache.get(KEY)) return false
  cache.set(KEY, remote)
  lastWritten = remote
  return true
}

export const dockerStorage: StateStorage = {
  getItem: key => cache.get(key) ?? null,
  setItem: (key, value) => {
    if (cache.get(key) === value) return
    cache.set(key, value)
    if (key === KEY) enqueue(value)
  },
  removeItem: key => {
    cache.delete(key)
    // 配置不允许直接删除，清理数据必须通过应用的重置操作
  },
}
