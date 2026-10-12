// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import type { OpenRouterImageEndpoint, OpenRouterImageModel } from './catalog'
import ModelCost from './ModelCost'

const mocks = vi.hoisted(() => ({ models: [] as OpenRouterImageModel[], fetchModels: vi.fn(), fetchEndpoints: vi.fn() }))
vi.mock('./catalog', () => ({
  fetchOpenRouterImageModels: mocks.fetchModels,
  fetchOpenRouterImageModelEndpoints: mocks.fetchEndpoints,
  readCachedOpenRouterImageModels: () => mocks.models,
  subscribeOpenRouterImageModels: () => () => {},
}))

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const profile: ApiProfile = {
  id: 'router', name: 'OpenRouter', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '',
  model: 'vendor/image', timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local',
}
const endpoint: OpenRouterImageEndpoint = { providerName: 'Vendor', providerSlug: 'vendor', supportedParameters: {}, pricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.04 }] }

beforeEach(() => {
  mocks.models = [{ id: 'vendor/image', name: 'Image', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' }]
  mocks.fetchModels.mockReset()
  mocks.fetchEndpoints.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(value = profile, n = 3) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root!.render(<ModelCost profile={value} n={n} />))
  return container
}

describe('OpenRouter 费用展示', () => {
  it('图像端点为空时使用明确的目录图像单价，并随数量更新和披露来源', async () => {
    mocks.models[0] = { ...mocks.models[0], pricing: { prompt: '0', completion: '0' }, displayPricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.01 }], displayPricingSource: { label: 'OpenRouter 目录显示价格', url: 'https://openrouter.ai/api/frontend/v1/models/find?order=newest' } }
    mocks.fetchEndpoints.mockResolvedValue([])
    const el = await render(profile, 1)
    expect(el.textContent).toContain('$0.01')
    await act(async () => root!.render(<ModelCost profile={profile} n={3} />))
    expect(el.textContent).toContain('$0.03')
    await act(async () => el.querySelector('button')!.click())
    const details = document.querySelector('[role="dialog"]')!
    expect(details.textContent).toContain('输出图像 $0.01 / 张')
    expect(details.textContent).not.toContain('输入文本 $0')
    expect(details.querySelector('a')?.getAttribute('href')).toContain('openrouter.ai')
  })

  it('仅在确认每张计费时显示数量对应的美元估算', async () => {
    mocks.fetchEndpoints.mockResolvedValue([endpoint])
    const el = await render()
    expect(el.textContent).toContain('约 $0.12 / 3 张')
    expect(el.textContent).toContain('USD')
    await act(async () => el.querySelector('button')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('最终以 OpenRouter 账单为准')
    await act(async () => root!.render(<ModelCost profile={profile} n={5} />))
    expect(el.textContent).toContain('约 $0.2 / 5 张')
  })

  it('未知计费单位不伪造每张总价', async () => {
    mocks.fetchEndpoints.mockResolvedValue([{ ...endpoint, pricing: [{ billable: 'output_image', unit: 'unknown', costUsd: 0.000002 }] }])
    const el = await render()
    expect(el.textContent).toContain('按用量计费')
    await act(async () => el.querySelector('button')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('无法可靠换算总价')
    expect(el.textContent).not.toContain('约 $')
  })

  it('失败时费用待确认并可以重试', async () => {
    mocks.fetchEndpoints.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([endpoint])
    const el = await render()
    expect(el.textContent).toContain('费用待确认')
    await act(async () => el.querySelector<HTMLButtonElement>('[title="定价加载失败"]')!.click())
    expect(el.textContent).toContain('约 $0.12 / 3 张')
  })

  it('主服务不请求或显示 OpenRouter 定价', async () => {
    const el = await render({ ...profile, provider: 'openai' })
    expect(el.textContent).toBe('')
    expect(mocks.fetchEndpoints).not.toHaveBeenCalled()
  })

  it('切换模型后不会复用旧模型的价格', async () => {
    mocks.fetchEndpoints.mockResolvedValueOnce([endpoint]).mockImplementationOnce(() => new Promise(() => {}))
    const el = await render()
    expect(el.textContent).toContain('$0.12')
    await act(async () => root!.render(<ModelCost profile={{ ...profile, model: 'vendor/other' }} n={3} />))
    expect(el.textContent).toContain('正在获取 OpenRouter 定价')
    expect(el.textContent).not.toContain('$0.12')
  })

  it('价格与详情为行内布局，明细可按 Escape 或点击外部关闭', async () => {
    mocks.fetchEndpoints.mockResolvedValue([endpoint])
    const el = await render()
    const cost = el.querySelector('[data-model-cost]')!
    expect(cost.classList.contains('inline-flex')).toBe(true)
    expect(cost.querySelector('button')!.textContent).toBe('详情')
    const button = cost.querySelector('button')!
    await act(async () => button.click())
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(panel).not.toBeNull()
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8)
    expect(Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(window.innerWidth - 16)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => button.click())
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })


  it('token 粗估使用紧凑行内金额，明细包含数量、参考图假设和来源', async () => {
    const modelId = 'google/gemini-3.1-flash-image-preview'
    mocks.models = [{ ...mocks.models[0], id: modelId }]
    mocks.fetchEndpoints.mockResolvedValue([{ ...endpoint, pricing: [{ billable: 'output_image', unit: 'token', costUsd: 0.00006 }] }])
    const el = await render({ ...profile, model: modelId }, 2)
    await act(async () => root!.render(<ModelCost profile={{ ...profile, model: modelId }} n={2} size="2048x2048" quality="high" prompt="a landscape" referenceImageCount={1} />))
    const headline = el.querySelector('[data-model-cost] > span')!.textContent!
    expect(headline).toContain('粗估 $')
    expect(headline).toContain('+')
    expect(headline).not.toContain('（')
    expect(headline).not.toContain('/ 2 张')
    await act(async () => el.querySelector('button')!.click())
    const panel = document.querySelector('[role="dialog"]')!
    expect(panel.textContent).toContain('共 2 张')
    expect(panel.textContent).toContain('参考图 1 张')
    expect(panel.textContent).toContain('token/张')
    expect(panel.querySelectorAll('a[href^="https://"]').length).toBeGreaterThan(0)
  })

})
