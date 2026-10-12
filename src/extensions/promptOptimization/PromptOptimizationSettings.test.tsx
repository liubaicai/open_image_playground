// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile, AppSettings } from '../../types'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import type { PromptOptimizationConfig, PromptOptimizationModel } from './types'
import PromptOptimizationSettings from './PromptOptimizationSettings'

const mocks = vi.hoisted(() => ({
  catalog: {} as Record<string, PromptOptimizationModel[]>,
  fetchModels: vi.fn(),
  onChange: vi.fn(),
  proxy: false,
  proxyTarget: '',
}))

vi.mock('./catalog', async (original) => ({
  ...(await original<typeof import('./catalog')>()),
  fetchPromptOptimizationModels: mocks.fetchModels,
  readCachedPromptOptimizationModels: (profile: ApiProfile) => mocks.catalog[profile.id] ?? [],
}))

vi.mock('./settings', () => ({
  normalizePromptOptimizationConfig: (value: Partial<PromptOptimizationConfig> | undefined) => ({ enabled: false, profileId: '', model: '', allowUnknownModel: false, ...value }),
  isPromptOptimizationProfile: (profile: ApiProfile) => profile.provider === 'openai' || profile.provider === 'openrouter',
  getPromptOptimizationRequestUrl: (profile: ApiProfile) => mocks.proxy && profile.provider === 'openai' ? '/api-proxy/chat/completions' : `${profile.baseUrl}/chat/completions`,
}))

vi.mock('../../lib/devProxy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/devProxy')>(),
  shouldUseApiProxy: () => mocks.proxy,
  readClientDevProxyConfig: () => mocks.proxyTarget ? { target: mocks.proxyTarget } : null,
}))

let root: ReturnType<typeof createRoot> | null = null
let replaceSettings: (settings: AppSettings) => void
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const profile: ApiProfile = {
  id: 'primary', name: '主服务', provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'existing-key',
  model: 'gpt-image-1, text-a', selectedModel: 'gpt-image-1', timeout: 600, apiMode: 'images', codexCli: false,
  apiProxy: false, transparentBackgroundMethod: 'local',
}
const routerProfile: ApiProfile = { ...profile, id: 'router', name: '路由服务', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/image' }
const knownModel: PromptOptimizationModel = { id: 'text-a', name: 'Text A', inputModalities: ['text'], outputModalities: ['text'], capability: 'verified' }
const imageModel: PromptOptimizationModel = { id: 'vendor/image', name: 'Image Only', inputModalities: ['text'], outputModalities: ['image'], capability: 'unsupported' }

beforeEach(() => {
  mocks.catalog = {}
  mocks.fetchModels.mockReset().mockResolvedValue([])
  mocks.onChange.mockReset()
  mocks.proxy = false
  mocks.proxyTarget = ''
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(config?: Partial<PromptOptimizationConfig>, profiles = [profile, routerProfile]) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const initial = {
    ...DEFAULT_SETTINGS,
    profiles,
    activeProfileId: profile.id,
    promptOptimization: { enabled: false, profileId: '', model: '', allowUnknownModel: false, ...config },
  }
  function Harness() {
    const [settings, setSettings] = useState<AppSettings>(initial)
    replaceSettings = setSettings
    return <PromptOptimizationSettings settings={settings} onChange={(promptOptimization) => {
      mocks.onChange(promptOptimization)
      setSettings((current) => ({ ...current, promptOptimization }))
    }} />
  }
  await act(async () => root!.render(<Harness />))
  return { container, initial }
}

async function selectModel(container: HTMLElement, profileId: string, model: string) {
  const select = container.querySelector<HTMLSelectElement>('[aria-label="优化文本模型"]')!
  await act(async () => {
    select.value = JSON.stringify([profileId, model])
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function typeModel(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('[aria-label="手动文本模型 ID"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(container: HTMLElement, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!
}

describe('提示词优化设置', () => {
  it('默认关闭且打开设置不发送任何请求', async () => {
    const { container } = await render()
    const enabled = container.querySelector<HTMLInputElement>('[aria-label="启用提示词优化"]')!
    expect(enabled.checked).toBe(false)
    expect(enabled.disabled).toBe(true)
    expect(mocks.fetchModels).not.toHaveBeenCalled()
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('保留原意与明确限制')
  })

  it('按供应商跨配置展示文本模型，排除图像专用及未知 OpenRouter 模型', async () => {
    mocks.catalog = {
      primary: [knownModel],
      router: [{ ...knownModel, id: 'vendor/text' }, imageModel, { ...knownModel, id: 'vendor/unknown', capability: 'unknown' }],
    }
    const unsupported = { ...profile, id: 'fal', provider: 'fal', model: 'fal-image' }
    const { container } = await render(undefined, [profile, routerProfile, unsupported])
    const select = container.querySelector<HTMLSelectElement>('[aria-label="优化文本模型"]')!
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['OpenAI / 兼容服务', 'OpenRouter'])
    expect(select.textContent).toContain('text-a')
    expect(select.textContent).toContain('vendor/text')
    expect(select.textContent).not.toContain('gpt-image-1')
    expect(select.textContent).not.toContain('Image Only')
    expect(select.textContent).not.toContain('vendor/unknown')
    expect(select.textContent).not.toContain('fal-image')
  })

  it('跨配置选择一次更新模型引用并撤销启用与未知模型确认', async () => {
    mocks.catalog = { primary: [knownModel], router: [{ ...knownModel, id: 'vendor/text' }] }
    const { container, initial } = await render({ enabled: true, profileId: profile.id, model: 'text-a', allowUnknownModel: true })
    await selectModel(container, routerProfile.id, 'vendor/text')
    expect(mocks.onChange).toHaveBeenCalledTimes(1)
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabled: false, profileId: 'router', model: 'vendor/text', allowUnknownModel: false })
    expect(initial.activeProfileId).toBe('primary')
    expect(initial.profiles[0].selectedModel).toBe('gpt-image-1')
    expect(JSON.stringify(mocks.onChange.mock.calls)).not.toContain('existing-key')
    const enabled = container.querySelector<HTMLInputElement>('[aria-label="启用提示词优化"]')!
    expect(enabled.checked).toBe(false)
    expect(enabled.disabled).toBe(false)
  })

  it.each(['gpt-4o', 'gpt-4.1', 'GPT-5', 'gateway/openai/gpt-5-2026-01-01'])('GPT 文本模型 %s 可直接启用且没有未验证提示', async (model) => {
    const { container } = await render({ profileId: profile.id, model })
    expect(container.querySelector('[aria-label="确认未验证模型兼容性"]')).toBeNull()
    expect(container.textContent).not.toContain('模型名称不能保证兼容')
    expect(container.querySelector<HTMLSelectElement>('select')?.selectedOptions[0]?.textContent).not.toContain('能力未验证')
    const enabled = container.querySelector<HTMLInputElement>('[aria-label="启用提示词优化"]')!
    expect(enabled.disabled).toBe(false)
    await act(async () => enabled.click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabled: true, profileId: 'primary', model, allowUnknownModel: false })
    expect(mocks.fetchModels).not.toHaveBeenCalled()
  })

  it('未知 OpenAI 模型需要单独确认后再显式启用且启用不请求服务', async () => {
    const { container } = await render({ profileId: profile.id, model: 'text-a' })
    const enabled = container.querySelector<HTMLInputElement>('[aria-label="启用提示词优化"]')!
    expect(enabled.disabled).toBe(true)
    expect(container.textContent).toContain('模型名称不能保证兼容')
    await act(async () => container.querySelector<HTMLInputElement>('[aria-label="确认未验证模型兼容性"]')!.click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabled: false, profileId: 'primary', model: 'text-a', allowUnknownModel: true })
    expect(enabled.disabled).toBe(false)
    await act(async () => enabled.click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabled: true, profileId: 'primary', model: 'text-a', allowUnknownModel: true })
    expect(mocks.fetchModels).not.toHaveBeenCalled()
  })

  it('编辑手动模型不自动保存，应用后停用并要求重新确认', async () => {
    mocks.catalog = { primary: [knownModel, imageModel] }
    const { container } = await render({ enabled: true, profileId: profile.id, model: 'text-a' })
    await typeModel(container, 'future-chat')
    expect(mocks.onChange).not.toHaveBeenCalled()
    await act(async () => button(container, '使用此模型').click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabled: false, profileId: 'primary', model: 'future-chat', allowUnknownModel: false })
    await typeModel(container, 'vendor/image')
    expect(button(container, '使用此模型').disabled).toBe(true)
    expect(container.textContent).toContain('此模型不支持文本输入和文本输出')
  })

  it('启用之前展示实际代理地址、上游、文字范围与收费提醒', async () => {
    mocks.catalog = { primary: [knownModel] }
    mocks.proxy = true
    mocks.proxyTarget = 'https://proxy-upstream.example/v1'
    const { container } = await render({ profileId: profile.id, model: 'text-a' })
    expect(container.textContent).toContain('/api-proxy/chat/completions')
    expect(container.textContent).toContain('https://proxy-upstream.example/v1')
    expect(container.textContent).toContain('不发送图片、附件或对话历史')
    expect(container.textContent).toContain('可能产生额外文本模型费用')
    expect(container.textContent).not.toContain('existing-key')
  })

  it('代理上游不可见时明确提示无法验证', async () => {
    mocks.catalog = { primary: [knownModel] }
    mocks.proxy = true
    const { container } = await render({ profileId: profile.id, model: 'text-a' })
    expect(container.textContent).toContain('实际上游由服务器配置，无法在前端验证')
  })

  it('显式刷新目录不自动保存或启用，失败可以重试', async () => {
    mocks.fetchModels.mockImplementation(async (target: ApiProfile) => {
      if (target.id === 'primary') throw new Error('暂时无法读取')
      return [{ ...knownModel, id: 'vendor/text' }]
    })
    const { container } = await render()
    await act(async () => button(container, '刷新文本模型目录').click())
    expect(mocks.fetchModels).toHaveBeenCalledTimes(2)
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain('主服务：暂时无法读取')
    expect(container.textContent).toContain('已有设置保持不变')
    expect(container.querySelector('select')!.textContent).toContain('vendor/text')
    expect(button(container, '重试加载文本模型')).toBeDefined()
  })

  it('连接被编辑时终止目录请求并忽略晚到结果', async () => {
    let resolve!: (models: PromptOptimizationModel[]) => void
    mocks.fetchModels.mockImplementation(() => new Promise<PromptOptimizationModel[]>((done) => { resolve = done }))
    const { container, initial } = await render(undefined, [profile])
    await act(async () => button(container, '刷新文本模型目录').click())
    const signal = mocks.fetchModels.mock.calls[0][1].signal as AbortSignal
    await act(async () => replaceSettings({ ...initial, profiles: [{ ...profile, baseUrl: 'https://new.example/v1' }] }))
    expect(signal.aborted).toBe(true)
    await act(async () => resolve([{ ...knownModel, id: 'stale-text' }]))
    expect(container.querySelector('select')!.textContent).not.toContain('stale-text')
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect(button(container, '刷新文本模型目录').disabled).toBe(false)
  })

  it('未知 OpenRouter 选择仅提示待验证，不能通过手动确认启用', async () => {
    const { container } = await render({ profileId: routerProfile.id, model: 'vendor/text', allowUnknownModel: true })
    expect(container.querySelector<HTMLInputElement>('[aria-label="启用提示词优化"]')!.disabled).toBe(true)
    expect(container.querySelector('[aria-label="确认未验证模型兼容性"]')).toBeNull()
    expect(container.textContent).toContain('当前选择待验证')
    expect(container.textContent).toContain('尚未验证所选模型的文本能力')
  })

  it('同名配置通过 ID 区分，避免选错接收方', async () => {
    const duplicate = { ...profile, id: 'secondary', apiKey: 'other-key' }
    mocks.catalog = { primary: [knownModel], secondary: [knownModel] }
    const { container } = await render(undefined, [profile, duplicate])
    const select = container.querySelector<HTMLSelectElement>('[aria-label="优化文本模型"]')!
    expect(select.textContent).toContain('主服务 (primary)')
    expect(select.textContent).toContain('主服务 (secondary)')
    expect(container.textContent).not.toContain('other-key')
  })

  it('关闭面板中止目录请求，不让晚到结果写入设置', async () => {
    let resolve!: (models: PromptOptimizationModel[]) => void
    mocks.fetchModels.mockImplementation(() => new Promise<PromptOptimizationModel[]>((done) => { resolve = done }))
    const { container } = await render(undefined, [profile])
    await act(async () => button(container, '刷新文本模型目录').click())
    const signal = mocks.fetchModels.mock.calls[0][1].signal as AbortSignal
    act(() => root?.unmount())
    root = null
    expect(signal.aborted).toBe(true)
    await act(async () => resolve([knownModel]))
    expect(mocks.onChange).not.toHaveBeenCalled()
  })
})
