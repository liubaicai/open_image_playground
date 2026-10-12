import type { AgentConversation, TaskRecord, StoredImage, StoredImageThumbnail } from '../types'

async function request<T>(path: string, method = 'GET', value?: unknown): Promise<T> {
  const res = await fetch('/storage-api/' + path, {
    method,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
    cache: 'no-store',
  })
  if (!res.ok) {
    const message = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(message.error || '共享存储操作失败 (' + res.status + ')')
  }
  return res.json() as Promise<T>
}
const path = (category: string, id: string) => category + '/' + encodeURIComponent(id)
export async function getAllTasks(): Promise<TaskRecord[]> {
  const tasks = await request<TaskRecord[]>('tasks')
  return tasks.sort((a, b) => b.createdAt - a.createdAt)
}
export async function putTask(task: TaskRecord): Promise<IDBValidKey> {
  await request(path('tasks', task.id), 'PUT', task)
  return task.id
}
export async function deleteTask(id: string): Promise<undefined> {
  await request(path('tasks', id), 'DELETE')
  return undefined
}
export async function commitTaskDeletion(deletedTaskIds: string[], updatedTasks: TaskRecord[], updatedConversations: AgentConversation[]): Promise<undefined> {
  await request('tasks/commit', 'POST', { deletedTaskIds, updatedTasks, updatedConversations })
  return undefined
}
export async function clearTasks(): Promise<undefined> {
  await request('tasks', 'DELETE')
  return undefined
}
export const getAllAgentConversations = () => request<AgentConversation[]>('conversations')
export async function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  await request(path('conversations', conversation.id), 'PUT', conversation)
  return conversation.id
}
export async function clearAgentConversations(): Promise<undefined> {
  await request('conversations', 'DELETE')
  return undefined
}
export async function replaceAgentConversations(conversations: AgentConversation[]): Promise<undefined> {
  await request('conversations/replace', 'POST', { conversations })
  return undefined
}
export async function getImage(id: string): Promise<StoredImage | undefined> {
  return request<StoredImage>(path('images', id)).catch((error: Error) => {
    if (error.message.includes('Not found')) return undefined
    throw error
  })
}
export async function getImageMeta(id: string): Promise<Omit<StoredImage, 'dataUrl'> | undefined> {
  const image = await getImage(id)
  if (!image) return undefined
  const { dataUrl, ...meta } = image
  return meta
}
export async function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return request<StoredImageThumbnail>(path('thumbnails', id)).catch((error: Error) => {
    if (error.message.includes('Not found')) return undefined
    throw error
  })
}
export async function putImageThumbnail(image: StoredImageThumbnail): Promise<IDBValidKey> {
  await request(path('thumbnails', image.id), 'PUT', image)
  return image.id
}
export async function getAllImages(): Promise<StoredImage[]> {
  const out: StoredImage[] = []
  for (const id of await getAllImageIds()) {
    const value = await getImage(id)
    if (value) out.push(value)
  }
  return out
}
export const getAllImageIds = () => request<string[]>('images')
export async function putImage(image: StoredImage): Promise<IDBValidKey> {
  await request(path('images', image.id), 'PUT', image)
  return image.id
}
export async function deleteImage(id: string): Promise<undefined> {
  await request(path('images', id), 'DELETE')
  return undefined
}
export async function clearImages(): Promise<undefined> {
  await request('images', 'DELETE')
  return undefined
}
