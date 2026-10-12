import type { ApiProfile } from '../../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import type { PromptOptimizationConfig } from './types'

export const DEFAULT_PROMPT_OPTIMIZATION_CONFIG: PromptOptimizationConfig = {
  enabled: false,
  profileId: '',
  model: '',
  allowUnknownModel: false,
}

export function isPromptOptimizationProfile(profile: ApiProfile): boolean {
  return profile.provider === 'openai' || profile.provider === 'openrouter'
}

export function normalizePromptOptimizationConfig(value: unknown, profiles?: ApiProfile[]): PromptOptimizationConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const profileId = typeof record.profileId === 'string' ? record.profileId.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  const profile = profiles?.find((item) => item.id === profileId && isPromptOptimizationProfile(item))
  if (profiles && !profile) return { ...DEFAULT_PROMPT_OPTIMIZATION_CONFIG }
  return {
    enabled: record.enabled === true && Boolean(profileId && model),
    profileId,
    model,
    allowUnknownModel: record.allowUnknownModel === true && Boolean(profileId && model) && profile?.provider !== 'openrouter',
  }
}

export function reconcilePromptOptimizationConfig(
  config: unknown,
  previousProfiles: ApiProfile[],
  nextProfiles: ApiProfile[],
): PromptOptimizationConfig {
  const normalized = normalizePromptOptimizationConfig(config, nextProfiles)
  const before = previousProfiles.find((profile) => profile.id === normalized.profileId)
  const after = nextProfiles.find((profile) => profile.id === normalized.profileId)
  // 同一 ID 下更换收件端、凭据或代理，也必须重新让用户确认启用。
  if (after && (!before || before.provider !== after.provider || before.baseUrl !== after.baseUrl
    || before.apiKey !== after.apiKey || before.apiProxy !== after.apiProxy || before.codexCli !== after.codexCli)) {
    return { ...normalized, enabled: false, allowUnknownModel: false }
  }
  return normalized
}

export function getPromptOptimizationRequestUrl(profile: ApiProfile, path = 'chat/completions'): string {
  if (!isPromptOptimizationProfile(profile)) throw new Error('提示词优化仅支持 OpenAI 兼容接口和 OpenRouter 配置')
  if (profile.provider === 'openrouter') {
    const base = profile.baseUrl.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1'
    if (base !== 'https://openrouter.ai/api/v1') throw new Error('OpenRouter 仅支持官方 API 地址 https://openrouter.ai/api/v1')
    return `${base}/${path.replace(/^\/+/, '')}`
  }
  const proxy = readClientDevProxyConfig()
  const useProxy = shouldUseApiProxy(profile.apiProxy, proxy)
  if (!useProxy && !profile.baseUrl.trim()) throw new Error('请先填写文本优化配置的 API 地址或启用可用代理')
  const url = buildApiUrl(profile.baseUrl, path, proxy, useProxy)
  if (!useProxy && !/^https?:\/\//i.test(url)) throw new Error('请填写有效的 HTTP(S) API 地址')
  return url
}
