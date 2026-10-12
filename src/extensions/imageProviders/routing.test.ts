import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { createDefaultOpenAIProfile, createDefaultOpenRouterProfile, normalizeSettings } from '../../lib/apiProfiles'
import { callImageApi } from '../../lib/api'
const adapters = vi.hoisted(() => ({ openai: vi.fn(), router: vi.fn(), fal: vi.fn() }))
vi.mock('../../lib/openaiCompatibleImageApi', () => ({ callOpenAICompatibleImageApi: adapters.openai }))
vi.mock('./openrouter', () => ({ callOpenRouterImageApi: adapters.router }))
vi.mock('../../lib/falAiImageApi', () => ({ callFalAiImageApi: adapters.fal }))

beforeEach(() => {
  vi.clearAllMocks()
  adapters.openai.mockResolvedValue({ images: [] })
  adapters.router.mockResolvedValue({ images: [] })
})

describe('image provider dispatch boundary', () => {
  it.each(['openai', 'openrouter'])('blocks %s historical retries when all models are disabled before any adapter/network work', async (provider) => {
    const profile = createDefaultOpenAIProfile({ provider, model: 'one,two', selectedModel: 'one', enabledModels: [], apiKey: 'fake-test' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    await expect(callImageApi({ settings, prompt: 'retry previous task', params: DEFAULT_PARAMS, inputImageDataUrls: [] })).rejects.toThrow('至少启用一个模型')
    expect(adapters.openai).not.toHaveBeenCalled()
    expect(adapters.router).not.toHaveBeenCalled()
    expect(adapters.fal).not.toHaveBeenCalled()
  })
  it('routes only the enabled selected model through its provider adapter', async () => {
    const profile = createDefaultOpenRouterProfile({ model: 'vendor/one,vendor/two', selectedModel: 'vendor/one', enabledModels: ['vendor/two'], apiKey: 'fake-test' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    await callImageApi({ settings, prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(adapters.router).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: 'openrouter', model: 'vendor/two' }))
    expect(adapters.openai).not.toHaveBeenCalled()
  })
  it('keeps legacy primary requests on original adapter', async () => {
    const profile = createDefaultOpenAIProfile({ model: 'legacy-primary' })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    await callImageApi({ settings, prompt: 'test', params: DEFAULT_PARAMS, inputImageDataUrls: [] })
    expect(adapters.openai).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: 'openai', model: 'legacy-primary' }), null)
    expect(adapters.router).not.toHaveBeenCalled()
  })
})
