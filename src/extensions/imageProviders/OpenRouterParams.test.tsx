// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiProfile, type TaskParams } from '../../types'
import { normalizeSettings } from '../../lib/apiProfiles'
import type { OpenRouterImageModel } from './catalog'
import OpenRouterParams from './OpenRouterParams'

const mocks = vi.hoisted(() => ({ models: [] as OpenRouterImageModel[], setParams: vi.fn() }))
vi.mock('./catalog', () => ({
  readCachedOpenRouterImageModels: () => mocks.models,
  subscribeOpenRouterImageModels: () => () => {},
}))
vi.mock('./ModelCost', () => ({ default: () => <span data-model-cost>费用估算</span> }))
vi.mock('../../components/Select', () => ({
  default: ({ value, onChange, options, disabled, prefix }: { value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; disabled?: boolean; prefix?: React.ReactNode }) => (
    <label>{prefix}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  ),
}))

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const profile: ApiProfile = { id: 'router', name: 'OpenRouter', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'vendor/image', enabledModels: ['vendor/image'], timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local' }
const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
const model: OpenRouterImageModel = { id: 'vendor/image', name: 'Image', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' }

beforeEach(() => { mocks.models = [model]; mocks.setParams.mockReset() })
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren() })

async function render(initial = DEFAULT_PARAMS, modelSelector?: React.ReactNode) {
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  function Harness() {
    const [params, setParams] = useState<TaskParams>(initial)
    return <OpenRouterParams modelSelector={modelSelector} profile={profile} modelOptions={[{ label: profile.model, value: profile.model }]} onModelChange={() => {}} params={params} setParams={(patch) => { mocks.setParams(patch); setParams((value) => ({ ...value, ...patch })) }} onOpenSizePicker={() => {}} agentAutoImageCount={false} showBatch={false} settings={settings} setSettings={() => {}} batchPromptCount={0} batchProgress={null} onStopBatch={() => {}} />
  }
  await act(async () => root!.render(<Harness />))
  return el
}

describe('OpenRouter 参数和配置选择', () => {
  it('不展示模型未声明的 OpenAI 专用参数', async () => {
    const el = await render()
    expect(el.textContent).toContain('数量')
    expect(el.textContent).toContain('尺寸')
    for (const text of ['质量', '格式', '审核', '压缩率']) expect(el.textContent).not.toContain(text)
  })

  it('切换模型后同步受支持的格式和质量，避免 UI 与请求不一致', async () => {
    mocks.models = [{ ...model, supportedParameters: { quality: { type: 'enum', values: ['xhigh'] }, output_format: { type: 'enum', values: ['jpeg'] } } }]
    const el = await render({ ...DEFAULT_PARAMS, quality: 'high', output_format: 'png' })
    expect(mocks.setParams).toHaveBeenCalledWith({ quality: 'auto', output_format: 'jpeg' })
    expect(el.querySelector('select option[value="jpeg"]:checked')).not.toBeNull()
    expect(el.querySelector('select option[value="auto"]:checked')).not.toBeNull()
    expect(el.querySelector('select option[value="xhigh"]')).not.toBeNull()
  })

  it('费用和详情入口直接紧接数量控件，不增加独立费用行', async () => {
    const el = await render()
    const count = el.querySelector('[aria-label="生成数量"]')!.closest('label')!
    const cost = el.querySelector('[data-model-cost]')!
    expect(cost.parentElement).toBe(count.parentElement)
    expect(count.nextElementSibling).toBe(cost)
    expect(cost.parentElement?.classList.contains('flex-col')).toBe(false)
  })

  it('画廊用统一模型入口替换原模型选择，Agent 缺省保持原入口', async () => {
    const el = await render(DEFAULT_PARAMS, <button data-unified-model>统一模型</button>)
    expect(el.querySelector('[data-unified-model]')).not.toBeNull()
    expect(el.querySelector('select')).toBeNull()
  })
})
