// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSettings } from '../../lib/apiProfiles'
import type { AppSettings } from '../../types'
import type { OpenRouterImageModel } from './catalog'
import GroupedModelSelect from './GroupedModelSelect'
import { getGroupedModelOptions, selectProfileModel } from './groupedModels'

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const settings = normalizeSettings({
  activeProfileId: 'primary', agentApiConfigMode: 'hybrid', agentTextProfileId: 'primary', agentImageProfileId: 'router',
  profiles: [
    { id: 'primary', name: '主服务', provider: 'openai', baseUrl: 'https://primary.example/v1', apiKey: 'fake-primary-key', model: 'shared-model, primary-only, disabled-model', enabledModels: ['shared-model', 'primary-only'], selectedModel: 'primary-only', apiMode: 'responses' },
    { id: 'backup', name: '备用服务', provider: 'openai', baseUrl: 'https://backup.example/v1', apiKey: 'fake-backup-key', model: 'shared-model', enabledModels: ['shared-model'] },
    { id: 'router', name: 'Router', provider: 'openrouter', apiKey: 'fake-router-key', model: 'vendor/image, vendor/retired', enabledModels: ['vendor/image', 'vendor/retired'], selectedModel: 'vendor/image' },
    { id: 'disabled', name: '全部停用', provider: 'openrouter', apiKey: '', model: 'vendor/disabled', enabledModels: [] },
  ],
})
const catalog: OpenRouterImageModel[] = [
  { id: 'vendor/image', name: 'Image', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' },
  { id: 'vendor/retired', name: 'Retired', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: false, source: 'frontend' },
]

afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren() })

async function render(value = settings, disabled = false, activeModel = 'primary-only') {
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  const onChange = vi.fn()
  await act(async () => root!.render(<GroupedModelSelect settings={value} activeProfileId="primary" activeModel={activeModel} catalog={catalog} onChange={onChange} disabled={disabled} />))
  return { el, onChange }
}

describe('跨配置分组模型选择', () => {
  it('单个下拉按 OpenAI 和 OpenRouter 分组，仅包含启用且可用的模型', async () => {
    const { el } = await render()
    expect(el.querySelectorAll('select')).toHaveLength(1)
    expect([...el.querySelectorAll('optgroup')].map((group) => group.label)).toEqual(['OpenAI', 'OpenRouter'])
    expect(el.querySelectorAll('option')).toHaveLength(4)
    for (const name of ['disabled-model', 'vendor/disabled', 'vendor/retired', '管理模型', '配置']) expect(el.textContent).not.toContain(name)
    expect(el.querySelector('select')?.getAttribute('aria-label')).toBe('模型')
  })

  it('模型入口收窄为 192px 并可继续收缩，长名称保留完整选项和提示', async () => {
    const model = 'vendor/a-very-long-image-generation-model-name-preview'
    const value = normalizeSettings({ ...settings, profiles: [{ ...settings.profiles[0], model, selectedModel: model, enabledModels: [model] }] })
    const { el } = await render(value, false, model)
    const select = el.querySelector('select')!
    expect(select.parentElement?.classList.contains('w-48')).toBe(true)
    expect(select.parentElement?.classList.contains('min-w-0')).toBe(true)
    expect(select.parentElement?.classList.contains('max-w-full')).toBe(true)
    expect(select.classList.contains('w-full')).toBe(true)
    expect(select.classList.contains('truncate')).toBe(true)
    expect(select.title).toBe(model)
    expect(select.selectedOptions[0].textContent).toBe(model)
  })

  it('原生分组弹层随系统明暗配色，并为选项和分组提供成对前景背景', async () => {
    const { el } = await render()
    expect(el.querySelector('select')?.style.colorScheme).toBe('light dark')
    for (const item of el.querySelectorAll('option, optgroup')) {
      expect(item.classList.contains('bg-white')).toBe(true)
      expect(item.classList.contains('text-gray-700')).toBe(true)
      expect(item.classList.contains('dark:bg-gray-800')).toBe(true)
      expect(item.classList.contains('dark:text-gray-200')).toBe(true)
      expect(item.className).not.toMatch(/hover:|checked:|selected:/)
    }
  })

  it('重复模型名称附配置名，不重复时保持简短的模型 ID', async () => {
    const { el } = await render()
    expect(el.textContent).toContain('shared-model · 主服务')
    expect(el.textContent).toContain('shared-model · 备用服务')
    expect(el.textContent).not.toContain('primary-only ·')
    const values = [...el.querySelectorAll('option')].map((option) => option.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('选择模型一次同时返回对应配置和模型，不需要再选择配置', async () => {
    const { el, onChange } = await render()
    await act(async () => {
      const select = el.querySelector('select')!
      select.value = JSON.stringify(['router', 'vendor/image'])
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('router', 'vendor/image')
  })

  it('批量运行禁用选择，全部停用则显示明确占位', async () => {
    const { el, onChange } = await render(settings, true)
    expect(el.querySelector('select')?.disabled).toBe(true)
    await act(async () => el.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true })))
    expect(onChange).not.toHaveBeenCalled()
    const empty = normalizeSettings({ ...settings, profiles: settings.profiles.map((profile) => ({ ...profile, enabledModels: [] })) })
    await act(async () => root!.render(<GroupedModelSelect settings={empty} activeProfileId="primary" activeModel="" catalog={catalog} onChange={onChange} />))
    expect(el.querySelector('select')?.disabled).toBe(true)
    expect(el.textContent).toContain('请先启用模型')
  })

  it('切换后保留双方凭据、启用偏好、供应商字段和 Agent 配置', () => {
    const before = JSON.parse(JSON.stringify(settings)) as AppSettings
    const next = selectProfileModel(settings, 'router', 'vendor/image')!
    expect(next.activeProfileId).toBe('router')
    expect(next.apiKey).toBe('fake-router-key')
    expect(next.profiles).toEqual(before.profiles)
    expect(next.agentTextProfileId).toBe('primary')
    expect(next.agentImageProfileId).toBe('router')
    const back = selectProfileModel(next, 'primary', 'shared-model')!
    expect(back.activeProfileId).toBe('primary')
    expect(back.apiKey).toBe('fake-primary-key')
    expect(back.profiles[0]).toEqual({ ...before.profiles[0], selectedModel: 'shared-model' })
    expect(back.profiles.slice(1)).toEqual(before.profiles.slice(1))
    expect(settings).toEqual(before)
    expect(selectProfileModel(settings, 'primary', 'disabled-model')).toBeNull()
    expect(selectProfileModel(settings, 'missing', 'vendor/image')).toBeNull()
  })

  it('保留 fal 和自定义供应商分组', () => {
    const extended = normalizeSettings({
      ...settings,
      customProviders: [{ id: 'private', name: '内网服务', submit: { path: 'images/generations' } }],
      profiles: [...settings.profiles, { id: 'fal', name: 'Fal', provider: 'fal', model: 'fal-model' }, { id: 'private', name: 'Private', provider: 'private', model: 'private-model' }],
    })
    expect(getGroupedModelOptions(extended, catalog).map((group) => group.label)).toEqual(['OpenAI', 'OpenRouter', 'fal.ai', '内网服务'])
  })
})
