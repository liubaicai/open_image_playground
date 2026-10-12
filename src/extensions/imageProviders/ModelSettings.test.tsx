// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import type { OpenRouterImageModel } from './catalog'
import ModelSettings from './ModelSettings'

const mocks = vi.hoisted(() => ({
  models: [] as OpenRouterImageModel[],
  fetchModels: vi.fn(),
  onChange: vi.fn(),
}))

vi.mock('./catalog', () => ({
  fetchOpenRouterImageModels: mocks.fetchModels,
  readCachedOpenRouterImageModels: () => mocks.models,
  subscribeOpenRouterImageModels: () => () => {},
}))

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const profile: ApiProfile = {
  id: 'primary', name: '主服务', provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: '',
  model: 'image-a, image-b', selectedModel: 'image-a', timeout: 600, apiMode: 'images', codexCli: false,
  apiProxy: false, transparentBackgroundMethod: 'local',
}

const models: OpenRouterImageModel[] = [
  { id: 'vendor/image-a', name: 'Image A', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' },
  { id: 'vendor/image-b', name: 'Image B', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' },
  { id: 'vendor/retired', name: 'Retired', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: false, source: 'frontend' },
]

beforeEach(() => {
  mocks.models = []
  mocks.fetchModels.mockReset()
  mocks.onChange.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(initial: ApiProfile, disabled = false) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  function Harness() {
    const [value, setValue] = useState(initial)
    return <ModelSettings profile={value} disabled={disabled} onChange={(patch) => { mocks.onChange(patch); setValue((current) => ({ ...current, ...patch })) }} />
  }
  await act(async () => root!.render(<Harness />))
  return container
}

describe('模型启用设置', () => {
  it('旧配置默认全部启用，取消当前模型时切换到仍启用的模型', async () => {
    const el = await render(profile)
    const checkboxes = [...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, true])
    await act(async () => checkboxes[0].click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabledModels: ['image-b'], selectedModel: 'image-b' })
    expect(mocks.fetchModels).not.toHaveBeenCalled()
  })

  it('全部停用保持空选择并提示不能生成', async () => {
    const el = await render(profile)
    const clear = [...el.querySelectorAll('button')].find((button) => button.textContent === '全部停用')!
    await act(async () => clear.click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ enabledModels: [], selectedModel: undefined })
    expect(el.textContent).toContain('启用至少一个模型后才能生成图像')
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((checkbox) => !checkbox.checked)).toBe(true)
  })

  it('拉取完整图像目录但不自动启用新模型，并禁用退役模型', async () => {
    mocks.fetchModels.mockImplementation(async () => { mocks.models = models; return models })
    const el = await render({ ...profile, provider: 'openrouter', model: 'vendor/image-a', selectedModel: 'vendor/image-a', enabledModels: ['vendor/image-a'] })
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect(el.querySelector<HTMLInputElement>('[aria-label="启用 vendor/image-b"]')?.checked).toBe(false)
    expect(el.querySelector<HTMLInputElement>('[aria-label="启用 vendor/retired"]')?.disabled).toBe(true)
    expect(el.textContent).toContain('当前图像 API 未提供此模型')
    const refresh = [...el.querySelectorAll('button')].find((button) => button.textContent === '刷新模型目录')!
    await act(async () => refresh.click())
    expect(mocks.fetchModels.mock.calls[mocks.fetchModels.mock.calls.length - 1]?.[0].force).toBe(true)
    expect(mocks.onChange).not.toHaveBeenCalled()
    await act(async () => el.querySelector<HTMLInputElement>('[aria-label="启用 vendor/image-b"]')!.click())
    expect(mocks.onChange).toHaveBeenLastCalledWith({ model: 'vendor/image-a, vendor/image-b, vendor/retired', enabledModels: ['vendor/image-a', 'vendor/image-b'], selectedModel: 'vendor/image-a' })
  })

  it('显式空选择在刷新和重新展示后仍然为空', async () => {
    mocks.models = models
    const el = await render({ ...profile, provider: 'openrouter', model: 'vendor/image-a', enabledModels: [], selectedModel: undefined })
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((checkbox) => !checkbox.checked)).toBe(true)
  })

  it('目录失败保留选择并提供重试', async () => {
    mocks.fetchModels.mockRejectedValue(new Error('目录暂时不可用'))
    const el = await render({ ...profile, provider: 'openrouter', model: 'vendor/image-a', enabledModels: ['vendor/image-a'] })
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('已有选择仍会保留')
    expect(el.textContent).toContain('重试加载目录')
    expect(el.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
  })

  it('明确告知当前目录来自官方公共备用接口', async () => {
    mocks.models = models.map((model) => ({ ...model, source: 'public' }))
    const el = await render({ ...profile, provider: 'openrouter' })
    expect(el.textContent).toContain('当前使用 OpenRouter 官方公共目录')
    expect(mocks.onChange).not.toHaveBeenCalled()
  })

  it('只读预置配置不能触发目录或修改模型', async () => {
    const el = await render({ ...profile, provider: 'openrouter' }, true)
    expect(mocks.fetchModels).not.toHaveBeenCalled()
    expect(mocks.onChange).not.toHaveBeenCalled()
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((checkbox) => checkbox.disabled)).toBe(true)
  })
})
