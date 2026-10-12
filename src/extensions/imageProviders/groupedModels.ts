import type { ApiProvider, AppSettings } from '../../types'
import { getApiProviderLabel, normalizeSettings } from '../../lib/apiProfiles'
import type { OpenRouterImageModel } from './catalog'
import { getEnabledProfileModels } from './modelPreferences'

export interface GroupedModelOption {
  profileId: string
  model: string
  label: string
  value: string
}

export function getGroupedModelOptions(settings: AppSettings, catalog: OpenRouterImageModel[] = []) {
  const choices = settings.profiles.flatMap((profile) => getEnabledProfileModels(profile)
    .filter((model) => profile.provider !== 'openrouter' || !catalog.length || catalog.some((item) => item.id === model && item.supportsImageApi))
    .map((model) => ({ profile, model })))
  const providers: ApiProvider[] = ['openai', 'openrouter', ...settings.profiles.map((profile) => profile.provider)]
  return [...new Set(providers)].map((provider) => ({
    provider,
    label: getApiProviderLabel(settings, provider),
    options: choices.filter((choice) => choice.profile.provider === provider).map(({ profile, model }): GroupedModelOption => {
      const duplicates = choices.filter((choice) => choice.model === model)
      const duplicateNames = duplicates.filter((choice) => choice.profile.name === profile.name)
      return {
        profileId: profile.id,
        model,
        label: duplicates.length > 1 ? `${model} · ${profile.name}${duplicateNames.length > 1 ? ` (${profile.id})` : ''}` : model,
        value: JSON.stringify([profile.id, model]),
      }
    }),
  })).filter((group) => group.options.length > 0)
}

/** 同一次设置更新切换配置及其模型，保留其他配置和 Agent 的独立选择。 */
export function selectProfileModel(settings: AppSettings, profileId: string, model: string): AppSettings | null {
  const target = settings.profiles.find((profile) => profile.id === profileId)
  if (!target || !getEnabledProfileModels(target).includes(model)) return null
  return normalizeSettings({
    ...settings,
    activeProfileId: profileId,
    profiles: settings.profiles.map((profile) => profile.id === profileId ? { ...profile, selectedModel: model } : profile),
  })
}
