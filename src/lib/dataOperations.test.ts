import { describe, expect, it } from 'vitest'
import type { AgentConversation, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { hasActiveDataOperations, hasInterruptibleOperations } from './dataOperations'

const task: TaskRecord = {
  id: 'task-a', prompt: '历史任务', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null,
}
const conversation: AgentConversation = {
  id: 'conversation-a', title: '旧 Agent 对话', activeRoundId: 'round-a', createdAt: 1, updatedAt: 1, messages: [],
  rounds: [{
    id: 'round-a', index: 1, parentRoundId: null, userMessageId: 'message-a', prompt: '旧请求',
    inputImageIds: [], outputTaskIds: [], status: 'running', error: null, createdAt: 1, finishedAt: null,
  }],
}

describe('画廊数据操作锁', () => {
  it.each([
    { sourceMode: 'agent' as const },
    { agentConversationId: 'conversation-a' },
    { agentRoundId: 'round-a' },
  ])('不把归档 Agent 任务 %j 当作进行中的工作', (source) => {
    const archived = { ...task, ...source, falRecoverable: true, customRecoverable: true }
    expect(hasActiveDataOperations([archived], [conversation])).toBe(false)
    expect(hasInterruptibleOperations([archived], [conversation], null)).toBe(false)
    expect(archived.status).toBe('running')
    expect(conversation.rounds[0].status).toBe('running')
  })

  it('归档对话不会阻塞关闭或导入导出，画廊任务仍受保护', () => {
    expect(hasActiveDataOperations([], [conversation])).toBe(false)
    expect(hasInterruptibleOperations([], [conversation], null)).toBe(false)
    expect(hasActiveDataOperations([task], [conversation])).toBe(true)
    expect(hasInterruptibleOperations([task], [conversation], null)).toBe(true)
  })
})
