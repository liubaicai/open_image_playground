import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../types'
import { normalizeParamsForSettings } from '../../lib/paramCompatibility'
import { createCustomProfileImportUrl } from '../../lib/profileImportUrl'
import { createDefaultOpenAIProfile, createDefaultOpenRouterProfile, DEFAULT_OPENROUTER_BASE_URL, getActiveApiProfile, getAgentTextApiProfile, normalizeApiProfile, normalizeSettings, resolveApiProfileModel, switchApiProfileProvider, validateApiProfile } from '../../lib/apiProfiles'
import { getEnabledProfileModels, normalizeEnabledModels } from './modelPreferences'

describe('模型启用迁移', () => {
  it('keeps legacy primary models enabled and selected model stable', () => {
    const profile = normalizeApiProfile({ model: 'one，two,one', selectedModel: 'two' })
    expect(profile.enabledModels).toBeUndefined()
    expect(getEnabledProfileModels(profile)).toEqual(['one', 'two'])
    expect(resolveApiProfileModel(profile).model).toBe('two')
  })
  it('normalizes external preferences without silently enabling models', () => {
    expect(normalizeEnabledModels([' a ', 5, '', 'a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeEnabledModels(null)).toBeUndefined()
    const profile = createDefaultOpenAIProfile({ model: 'one,two', enabledModels: ['two'], selectedModel: 'one' })
    expect(getEnabledProfileModels(profile)).toEqual(['two'])
    expect(resolveApiProfileModel(profile, 'one').model).toBe('two')
  })
  it('retains explicitly zero enabled models through JSON settings persistence', () => {
    const original = createDefaultOpenAIProfile({ apiKey: 'test-placeholder', model: 'one,two', enabledModels: [] })
    const settings = normalizeSettings(JSON.parse(JSON.stringify({ profiles: [original], activeProfileId: original.id })))
    const active = getActiveApiProfile(settings)
    expect(settings.profiles[0].model).toBe('one, two')
    expect(active.model).toBe('')
    expect(active.enabledModels).toEqual([])
    expect(validateApiProfile(active)).toBe('请至少启用一个模型')
  })
  it('keeps provider model sets independent and never copies keys across OpenRouter boundary', () => {
    const primary = createDefaultOpenAIProfile({ model: 'one,two', selectedModel: 'two', enabledModels: ['two'], apiKey: 'primary-test-placeholder' })
    const router = switchApiProfileProvider(primary, 'openrouter')
    expect(router.apiKey).toBe('')
    expect(router.model).toBe('')
    expect(router.enabledModels).toEqual([])
    const configuredRouter = { ...router, model: 'vendor/image', enabledModels: ['vendor/image'], apiKey: 'router-test-placeholder' }
    const restored = normalizeApiProfile(switchApiProfileProvider(configuredRouter, 'openai'))
    expect(restored.apiKey).toBe('')
    expect(restored.model).toBe('one, two')
    expect(restored.enabledModels).toEqual(['two'])
    expect(restored.selectedModel).toBe('two')
    expect(JSON.stringify(restored.providerDrafts)).not.toContain('placeholder')
    const returned = switchApiProfileProvider(restored, 'openrouter')
    expect(returned.model).toBe('vendor/image')
    expect(returned.enabledModels).toEqual(['vendor/image'])
  })
  it('pins imported OpenRouter endpoint and ignores OpenAI-specific flags', () => {
    const profile = normalizeApiProfile({ provider: 'openrouter', baseUrl: 'https://unrelated.invalid', model: 'vendor/image', apiMode: 'responses', codexCli: true, apiProxy: true, streamImages: true, transparentBackgroundMethod: 'api' })
    expect(profile.provider).toBe('openrouter')
    expect(profile.baseUrl).toBe(DEFAULT_OPENROUTER_BASE_URL)
    expect(profile).toMatchObject({ apiMode: 'images', codexCli: false, apiProxy: false, streamImages: false, transparentBackgroundMethod: 'local' })
  })
  it('keeps OpenAI Agent text configuration independent', () => {
    const text = createDefaultOpenAIProfile({ id: 'text', model: 'text-model', apiMode: 'responses' })
    const image = createDefaultOpenRouterProfile({ id: 'router', model: 'vendor/image', enabledModels: ['vendor/image'] })
    const settings = normalizeSettings({ profiles: [text, image], activeProfileId: image.id, agentApiConfigMode: 'hybrid', agentTextProfileId: text.id, agentImageProfileId: image.id })
    expect(getAgentTextApiProfile(settings)?.provider).toBe('openai')
    expect(getActiveApiProfile(settings).model).toBe('vendor/image')
  })
  it('preserves advertised OpenRouter quality and dimensions instead of applying GPT-only rules', () => {
    const profile = createDefaultOpenRouterProfile({ model: 'vendor/image', enabledModels: ['vendor/image'] })
    const settings = normalizeSettings({ profiles: [profile], activeProfileId: profile.id })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2K', quality: 'max', n: 20 }, settings)).toMatchObject({ size: '2K', quality: 'max', n: 10 })
  })
  it('shares model preferences without a key when key export is disabled', () => {
    const profile = createDefaultOpenRouterProfile({ model: 'vendor/a,vendor/b', enabledModels: ['vendor/b'], apiKey: 'never-share-test-placeholder' })
    const url = createCustomProfileImportUrl('https://example.com', profile, undefined, { includeApiKey: false, useNewApiAddress: false, useNewApiKey: false, useNewApiModel: false })
    const data = JSON.parse(new URL(url).searchParams.get('settings')!)
    expect(data.profiles[0].apiKey).toBe('')
    expect(data.profiles[0].enabledModels).toEqual(['vendor/b'])
    expect(decodeURIComponent(url)).not.toContain(profile.apiKey)
  })

})
