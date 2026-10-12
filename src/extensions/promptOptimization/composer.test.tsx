// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../types'
import { DEFAULT_PARAMS } from '../../types'
import { normalizeSettings } from '../../lib/apiProfiles'
import type { PromptOptimizationModel } from './types'
import { useStore, submitTask, submitAgentMessage } from '../../store'
import InputBar from '../../components/InputBar'

const mocks = vi.hoisted(() => ({ optimize: vi.fn(), fetchModels: vi.fn(), cached: [] as PromptOptimizationModel[], submitTask: vi.fn(), submitAgent: vi.fn() }))
vi.mock('./api', () => ({ optimizePrompt: mocks.optimize }))
vi.mock('./catalog', async (original) => ({
  ...(await original<typeof import('./catalog')>()),
  fetchPromptOptimizationModels: mocks.fetchModels,
  readCachedPromptOptimizationModels: () => mocks.cached,
}))
vi.mock('../../store', async (original) => ({ ...(await original<typeof import('../../store')>()), submitTask: mocks.submitTask, submitAgentMessage: mocks.submitAgent }))

let root: ReturnType<typeof createRoot> | null = null
let el: HTMLDivElement
const showToast = vi.fn()
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function settings(): AppSettings {
  return normalizeSettings({
    activeProfileId: 'primary',
    profiles: [
      { id: 'primary', name: '主服务', provider: 'openai', baseUrl: 'https://primary.example/v1', apiKey: 'fake-primary', model: 'gpt-image-1', apiMode: 'images' },
      { id: 'text', name: '文本服务', provider: 'openai', baseUrl: 'https://text.example/v1', apiKey: 'fake-text', model: 'text-model', apiMode: 'responses' },
      { id: 'router', name: 'Router', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'fake-router', model: 'vendor/text' },
    ],
    promptOptimization: { enabled: true, profileId: 'text', model: 'text-model', allowUnknownModel: false },
  })
}

function button(label: string) { return el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) }
async function render() {
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root!.render(<InputBar />))
  return el
}
async function click(label: string) { await act(async () => button(label)!.click()) }
function pending() {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((done, fail) => { resolve = done; reject = fail })
  mocks.optimize.mockReturnValueOnce(promise)
  return { resolve, reject }
}
function changeSettings(update: (current: AppSettings) => AppSettings) {
  useStore.setState({ settings: update(useStore.getState().settings) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.cached = [{ id: 'text-model', name: 'Text', inputModalities: ['text'], outputModalities: ['text'], capability: 'verified' }]
  mocks.fetchModels.mockReset().mockImplementation(async () => mocks.cached)
  mocks.optimize.mockReset()
  useStore.setState({
    settings: settings(), params: { ...DEFAULT_PARAMS }, prompt: '一只猫\n原始细节', appMode: 'gallery', inputImages: [], tasks: [],
    agentConversations: [], activeAgentConversationId: null, batchProgress: null, maskDraft: null, reusedTaskApiProfileId: null, reusedTaskApiModel: null,
    filterFavorite: false, activeFavoriteCollectionId: null, selectedTaskIds: [], selectedFavoriteCollectionIds: [], favoriteCollections: [],
    setPrompt: (prompt) => useStore.setState({ prompt }), showToast,
  })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('提示词优化输入框', () => {
  it('默认关闭，无模型请求；启用后优化按钮紧邻清空文本左侧，空输入时禁用', async () => {
    changeSettings((current) => ({ ...current, promptOptimization: undefined }))
    await render()
    expect(button('优化提示词')).toBeNull()
    expect(mocks.fetchModels).not.toHaveBeenCalled()
    await act(async () => changeSettings(() => settings()))
    const clear = button('清空文本')!
    const actions = [...clear.parentElement!.parentElement!.querySelectorAll('button')]
    expect(actions.map((item) => item.getAttribute('aria-label'))).toEqual(['优化提示词', '清空文本'])
    expect(mocks.fetchModels).not.toHaveBeenCalled()
    await act(async () => useStore.getState().setPrompt('  '))
    expect(button('优化提示词')!.disabled).toBe(true)
    await act(async () => useStore.getState().setPrompt(''))
    expect(button('优化提示词')!.disabled).toBe(true)
    expect(button('清空文本')).toBeNull()
    expect(mocks.optimize).not.toHaveBeenCalled()
  })

  it('仅明确点击发送当前文字，阻止重复点击，替换可编辑输入并能完整撤销', async () => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await act(async () => { button('优化提示词')!.click(); button('优化提示词')!.click() })
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
    expect(mocks.optimize).toHaveBeenCalledWith(useStore.getState().settings.profiles[1], 'text-model', original, expect.any(AbortSignal))
    expect(button('优化提示词')!.disabled).toBe(true)
    expect(button('取消优化')).not.toBeNull()
    expect(submitTask).not.toHaveBeenCalled()
    expect(submitAgentMessage).not.toHaveBeenCalled()
    await act(async () => request.resolve('优化后的猫咪场景'))
    expect(useStore.getState().prompt).toBe('优化后的猫咪场景')
    expect(el.querySelector('[contenteditable]')!.textContent).toBe('优化后的猫咪场景')
    expect(button('优化提示词')!.disabled).toBe(false)
    expect(button('取消优化')).toBeNull()
    await click('撤销提示词优化')
    expect(useStore.getState().prompt).toBe(original)
    expect(button('撤销提示词优化')).toBeNull()
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
  })

  it('编辑再还原也会中止旧请求，迟到结果不能覆盖输入', async () => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    const signal = mocks.optimize.mock.calls[0][3] as AbortSignal
    await act(async () => {
      useStore.getState().setPrompt('新输入')
      useStore.getState().setPrompt(original)
      request.resolve('迟到的结果')
    })
    expect(signal.aborted).toBe(true)
    expect(useStore.getState().prompt).toBe(original)
    expect(button('撤销提示词优化')).toBeNull()
  })

  it('直接编辑 contentEditable 取消请求并保留新输入', async () => {
    const request = pending()
    await render()
    await click('优化提示词')
    const editor = el.querySelector<HTMLDivElement>('[contenteditable]')!
    await act(async () => {
      editor.textContent = '用户刚刚输入的新内容'
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => request.resolve('旧优化结果'))
    expect(useStore.getState().prompt).toBe('用户刚刚输入的新内容')
    expect(editor.textContent).toBe('用户刚刚输入的新内容')
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
  })

  it('输入法开始组合输入时先取消优化，避免覆盖尚未提交的文字', async () => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    await act(async () => el.querySelector('[contenteditable]')!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await act(async () => request.resolve('迟到结果'))
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(useStore.getState().prompt).toBe(original)
  })

  it('清空及取消操作立即中止请求且迟到结果不回填', async () => {
    const first = pending()
    await render()
    await click('优化提示词')
    await click('清空文本')
    await act(async () => first.resolve('不可回填'))
    expect(useStore.getState().prompt).toBe('')
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    await act(async () => useStore.getState().setPrompt('保留原文'))
    const second = pending()
    await click('优化提示词')
    await click('取消优化')
    await act(async () => second.resolve('不可回填'))
    expect(useStore.getState().prompt).toBe('保留原文')
    expect((mocks.optimize.mock.calls[1][3] as AbortSignal).aborted).toBe(true)
  })

  it('旧请求结束不会关闭随后新请求的加载状态', async () => {
    const first = pending()
    await render()
    await click('优化提示词')
    await click('取消优化')
    const second = pending()
    await click('优化提示词')
    await act(async () => first.resolve('旧请求'))
    expect(button('优化提示词')!.disabled).toBe(true)
    expect(button('取消优化')).not.toBeNull()
    await act(async () => second.resolve('最新请求'))
    expect(useStore.getState().prompt).toBe('最新请求')
  })

  it.each(['key', 'url', 'provider', 'proxy', 'codex', 'model', 'profile', 'disable', 'remove', 'navigation'])('变更 %s 会作废旧请求', async (kind) => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    await act(async () => {
      if (kind === 'navigation') useStore.setState({ filterFavorite: true })
      else changeSettings((current) => ({
        ...current,
        profiles: kind === 'remove' ? current.profiles.filter((profile) => profile.id !== 'text') : current.profiles.map((profile) => profile.id !== 'text' ? profile : {
          ...profile,
          ...(kind === 'key' ? { apiKey: 'changed-fake-key' } : {}),
          ...(kind === 'url' ? { baseUrl: 'https://new.example/v1' } : {}),
          ...(kind === 'provider' ? { provider: 'openrouter' } : {}),
          ...(kind === 'proxy' ? { apiProxy: !profile.apiProxy } : {}),
          ...(kind === 'codex' ? { codexCli: !profile.codexCli } : {}),
        }),
        promptOptimization: { ...current.promptOptimization!, ...(kind === 'model' ? { model: 'another-text' } : {}), ...(kind === 'profile' ? { profileId: 'router' } : {}), ...(kind === 'disable' ? { enabled: false } : {}) },
      }))
      request.resolve('迟到结果')
    })
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(useStore.getState().prompt).toBe(original)
    expect(button('撤销提示词优化')).toBeNull()
  })

  it.each(['pagehide', 'popstate', 'hashchange'])('浏览器 %s 会取消请求', async (event) => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    await act(async () => window.dispatchEvent(new Event(event)))
    await act(async () => request.resolve('迟到结果'))
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(useStore.getState().prompt).toBe(original)
  })

  it('组件卸载后不应用结果', async () => {
    const request = pending()
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    await act(async () => root!.unmount())
    root = null
    await act(async () => request.resolve('迟到结果'))
    expect((mocks.optimize.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    expect(useStore.getState().prompt).toBe(original)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('失败解释原因并保留文本，允许再次优化', async () => {
    mocks.optimize.mockRejectedValueOnce(new Error('服务请求超时'))
    await render()
    const original = useStore.getState().prompt
    await click('优化提示词')
    expect(useStore.getState().prompt).toBe(original)
    expect(showToast).toHaveBeenCalledWith('提示词优化失败：服务请求超时', 'error')
    expect(button('优化提示词')!.disabled).toBe(false)
    expect(button('撤销提示词优化')).toBeNull()
  })

  it('优化成功后继续编辑，不再提供会覆盖用户编辑的撤销', async () => {
    mocks.optimize.mockResolvedValueOnce('优化文本')
    await render()
    await click('优化提示词')
    expect(button('撤销提示词优化')).not.toBeNull()
    await act(async () => useStore.getState().setPrompt('继续编辑后的文本'))
    expect(button('撤销提示词优化')).toBeNull()
  })

  it('模型列表查询期间清空可阻止后续 POST', async () => {
    let resolve!: (models: PromptOptimizationModel[]) => void
    mocks.fetchModels.mockReturnValueOnce(new Promise<PromptOptimizationModel[]>((done) => { resolve = done }))
    await render()
    await click('优化提示词')
    await click('清空文本')
    await act(async () => resolve(mocks.cached))
    expect(mocks.optimize).not.toHaveBeenCalled()
    expect(useStore.getState().prompt).toBe('')
  })

  it('不兼容模型被阻止；未知模型只有主服务明确同意后才允许', async () => {
    mocks.cached = [{ id: 'text-model', name: 'Image', inputModalities: ['text'], outputModalities: ['image'], capability: 'unsupported' }]
    await render()
    await click('优化提示词')
    expect(mocks.optimize).not.toHaveBeenCalled()
    expect(showToast.mock.calls[showToast.mock.calls.length - 1]?.[0]).toContain('不支持纯文本')
    mocks.cached = []
    await click('优化提示词')
    expect(mocks.optimize).not.toHaveBeenCalled()
    await act(async () => changeSettings((current) => ({ ...current, promptOptimization: { ...current.promptOptimization!, allowUnknownModel: true } })))
    mocks.optimize.mockResolvedValueOnce('手动确认的文本模型结果')
    await click('优化提示词')
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
    await act(async () => changeSettings((current) => ({ ...current, promptOptimization: { enabled: true, profileId: 'router', model: 'vendor/text', allowUnknownModel: true } })))
    await click('优化提示词')
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[showToast.mock.calls.length - 1]?.[0]).toContain('无法确认 OpenRouter')
  })

  it('主服务 GPT 文本模型不需要未知能力确认，目录不可用仍可显式优化', async () => {
    changeSettings((current) => ({ ...current, promptOptimization: { enabled: true, profileId: 'text', model: 'gateway/GPT-5', allowUnknownModel: false } }))
    mocks.cached = []
    mocks.fetchModels.mockRejectedValue(new Error('目录不可用'))
    mocks.optimize.mockResolvedValue('优化结果')
    await render()
    await click('优化提示词')
    expect(mocks.optimize).toHaveBeenCalledOnce()
    expect(useStore.getState().prompt).toBe('优化结果')
  })

  it('目录失败仅在主服务明确允许未知模型时回退', async () => {
    mocks.fetchModels.mockRejectedValue(new Error('目录不可用'))
    await render()
    await click('优化提示词')
    expect(mocks.optimize).not.toHaveBeenCalled()
    await act(async () => changeSettings((current) => ({ ...current, promptOptimization: { ...current.promptOptimization!, allowUnknownModel: true } })))
    mocks.optimize.mockResolvedValueOnce('已优化')
    await click('优化提示词')
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
  })

  it('主服务支持无需 API Key 的本地文本兼容接口', async () => {
    changeSettings((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.id === 'text' ? { ...profile, apiKey: '' } : profile) }))
    mocks.optimize.mockResolvedValueOnce('本地优化文本')
    await render()
    await click('优化提示词')
    expect(mocks.optimize).toHaveBeenCalledTimes(1)
    expect(useStore.getState().prompt).toBe('本地优化文本')
  })

  it('旧运行态仍为 Agent 时也只显示画廊模型选择并提交图像任务', async () => {
    useStore.setState({ appMode: 'agent' })
    await render()
    expect(el.textContent).not.toContain('Agent')
    expect(el.querySelector('[aria-label="模型"]')).not.toBeNull()
    await click('生成图像')
    expect(submitTask).toHaveBeenCalledTimes(1)
    expect(submitAgentMessage).not.toHaveBeenCalled()
  })
})
