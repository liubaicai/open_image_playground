import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import {
  DEFAULT_PROMPT_OPTIMIZATION_CONFIG,
  getPromptOptimizationRequestUrl,
  isPromptOptimizationProfile,
  normalizePromptOptimizationConfig,
  reconcilePromptOptimizationConfig,
} from './settings'

const profile: ApiProfile = {
  id: 'text', name: 'Text', provider: 'openai', baseUrl: 'https://text.example/v1', apiKey: 'test-key', model: 'image-model',
  timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local',
}
const config = { enabled: true, profileId: 'text', model: 'text-model', allowUnknownModel: true }

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('prompt optimization settings', () => {
  it('defaults off with no provider, credentials, or model copied from image settings', () => {
    expect(normalizePromptOptimizationConfig(undefined, [profile])).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
    expect(normalizePromptOptimizationConfig({ enabled: true, apiKey: 'discard' })).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
    expect(normalizePromptOptimizationConfig(['bad'])).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
  })

  it('normalizes strict booleans and model strings without inferring activation', () => {
    expect(normalizePromptOptimizationConfig({ enabled: 'true', profileId: ' text ', model: ' text-model ', allowUnknownModel: 1 }, [profile]))
      .toEqual({ enabled: false, profileId: 'text', model: 'text-model', allowUnknownModel: false })
    expect(normalizePromptOptimizationConfig(config, [profile])).toEqual(config)
    expect(normalizePromptOptimizationConfig({ ...config, model: '' }, [profile]).enabled).toBe(false)
  })

  it('clears removed or unsupported selected profiles and OpenRouter unknown consent', () => {
    expect(normalizePromptOptimizationConfig(config, [])).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
    expect(normalizePromptOptimizationConfig(config, [{ ...profile, provider: 'fal' }])).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
    expect(normalizePromptOptimizationConfig(config, [{ ...profile, provider: 'openrouter' }]).allowUnknownModel).toBe(false)
    expect(isPromptOptimizationProfile(profile)).toBe(true)
    expect(isPromptOptimizationProfile({ ...profile, provider: 'custom' })).toBe(false)
  })

  it.each([
    { baseUrl: 'https://changed.example/v1' }, { provider: 'openrouter' }, { apiKey: 'changed' }, { apiProxy: true }, { codexCli: true },
  ])('invalidates activation and unknown consent after route changes %o', (patch) => {
    expect(reconcilePromptOptimizationConfig(config, [profile], [{ ...profile, ...patch }])).toMatchObject({ enabled: false, allowUnknownModel: false })
  })

  it('keeps consent when only unrelated image settings or display name change', () => {
    expect(reconcilePromptOptimizationConfig(config, [profile], [{ ...profile, name: 'Renamed', model: 'new-image-model', selectedModel: 'new-image-model', timeout: 120 }])).toEqual(config)
    expect(reconcilePromptOptimizationConfig(undefined, [profile], [profile])).toEqual(DEFAULT_PROMPT_OPTIMIZATION_CONFIG)
    expect(reconcilePromptOptimizationConfig(config, [], [profile])).toMatchObject({ enabled: false, allowUnknownModel: false })
  })

  it('shares custom base URL joining and proxy behavior with image APIs', () => {
    expect(() => getPromptOptimizationRequestUrl({ ...profile, baseUrl: '' })).toThrow('API 地址')
    expect(getPromptOptimizationRequestUrl({ ...profile, baseUrl: 'https://text.example/custom/' })).toBe('https://text.example/custom/chat/completions')
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    expect(getPromptOptimizationRequestUrl({ ...profile, baseUrl: '', apiProxy: true })).toBe('/api-proxy/chat/completions')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    expect(getPromptOptimizationRequestUrl(profile, 'models')).toBe('/api-proxy/models')
  })

  it('limits OpenRouter credentials to its official direct endpoint even with proxy enabled', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    expect(getPromptOptimizationRequestUrl({ ...profile, provider: 'openrouter', baseUrl: '', apiProxy: true })).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(() => getPromptOptimizationRequestUrl({ ...profile, provider: 'openrouter' })).toThrow('官方')
    expect(() => getPromptOptimizationRequestUrl({ ...profile, provider: 'fal' })).toThrow('仅支持')
  })
})
