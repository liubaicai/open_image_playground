import type { ApiProfile } from '../../types'

/** 缺省沿用旧版模型列表；空数组明确表示全部停用。 */
export function normalizeEnabledModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
}

export function getEnabledProfileModels(profile: Pick<ApiProfile, 'model' | 'enabledModels'>): string[] {
  const models = [...new Set(profile.model.split(/[,，]/).map((model) => model.trim()).filter(Boolean))]
  const enabled = normalizeEnabledModels(profile.enabledModels)
  return enabled === undefined ? models : models.filter((model) => enabled.includes(model))
}
