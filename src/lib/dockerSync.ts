import { getAllTasks } from './db'
import { isDockerSharedStorage, reloadDockerStorage } from './dockerStorage'
import { useStore } from '../store'

let lastRevision: number | undefined
let active = false

export async function syncDockerStorage() {
  if (!isDockerSharedStorage || active) return
  active = true
  try {
    const res = await fetch('/storage-api/revision', { cache: 'no-store' })
    if (!res.ok) throw new Error('共享数据版本查询失败 (' + res.status + ')')
    const info = await res.json() as { revision: number }
    if (lastRevision === info.revision) return
    lastRevision = info.revision
    const settingsChanged = await reloadDockerStorage()
    if (settingsChanged) await useStore.persist.rehydrate()
    const serverTasks = await getAllTasks()
    const current = useStore.getState().tasks
    if (JSON.stringify(serverTasks) !== JSON.stringify(current)) {
      useStore.setState({ tasks: serverTasks })
    }
  } catch (error) {
    console.warn('同步 Docker 共享数据失败：', error)
  } finally {
    active = false
  }
}
