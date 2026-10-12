import type { ApiProfile } from '../../types'
import { apiFetch } from '../../lib/platform'
import { getPromptOptimizationRequestUrl } from './settings'
import type { PromptOptimizationCapability, PromptOptimizationModel } from './types'

class PromptCatalogError extends Error {}

export const OPENROUTER_TEXT_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_MS = 5 * 60 * 1000
// 使用配置对象作为弱引用，不复制密钥到目录缓存或持久化数据。
const cache = new WeakMap<ApiProfile, { at: number; models: PromptOptimizationModel[] }>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isKnownNonTextOptimizationModel(model: string): boolean {
  // 兼容供应商命名空间和版本后缀，GPT 图像家族始终不能用于文本优化。
  return /(?:^|[/:])(?:gpt-image|dall-e(?:-|:|$)|text-embedding(?:-|:|$)|whisper(?:-|:|$)|tts(?:-|:|$)|gpt-(?:4o(?:-mini)?-(?:transcribe|tts|realtime)|realtime)(?:-|:|$)|(?:text-|omni-)?moderation(?:-|:|$)|sora(?:-|:|$))/i.test(model.trim())
}

function getModelNameCapability(model: string, provider?: ApiProfile['provider']): PromptOptimizationCapability {
  if (isKnownNonTextOptimizationModel(model)) return 'unsupported'
  // 按用户要求，OpenAI 兼容渠道的 GPT 默认可用；verified 在此表示应用策略，并非目录能力证明。
  return provider === 'openai' && /(?:^|[/:])gpt-/i.test(model.trim()) ? 'verified' : 'unknown'
}

export function normalizePromptOptimizationModels(payload: unknown, provider: 'openai' | 'openrouter'): PromptOptimizationModel[] {
  const values = Array.isArray(payload) ? payload : isRecord(payload) ? payload.data : undefined
  if (!Array.isArray(values)) throw new PromptCatalogError('文本模型目录格式无法识别')
  const models = new Map<string, PromptOptimizationModel>()
  for (const value of values) {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) continue
    const architecture = isRecord(value.architecture) ? value.architecture : {}
    const rawInput = value.input_modalities ?? architecture.input_modalities
    const rawOutput = value.output_modalities ?? architecture.output_modalities
    const inputModalities = Array.isArray(rawInput) ? rawInput.filter((item): item is string => typeof item === 'string') : []
    const outputModalities = Array.isArray(rawOutput) ? rawOutput.filter((item): item is string => typeof item === 'string') : []
    const nameCapability = getModelNameCapability(value.id, provider)
    // 明确的不兼容元数据优先；OpenRouter 仍只接受明确的双向文本能力字段。
    const capability = nameCapability === 'unsupported' || (Array.isArray(rawInput) && !inputModalities.includes('text')) || (Array.isArray(rawOutput) && !outputModalities.includes('text'))
      ? 'unsupported'
      : inputModalities.includes('text') && outputModalities.includes('text') ? 'verified'
        : nameCapability
    const id = value.id.trim()
    const existing = models.get(id)
    // 重复且冲突的目录项保守处理，不让较弱的后续声明覆盖已知的不兼容信息。
    if (existing?.capability === 'unsupported' || (existing?.capability === 'verified' && capability === 'unknown')) continue
    models.set(id, {
      id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
      inputModalities,
      outputModalities,
      capability,
    })
  }
  return [...models.values()]
}

export function getPromptOptimizationModelCapability(model: string, models: PromptOptimizationModel[], provider?: ApiProfile['provider']): PromptOptimizationCapability {
  const nameCapability = getModelNameCapability(model, provider)
  if (nameCapability === 'unsupported') return 'unsupported'
  const capability = models.find((item) => item.id === model.trim())?.capability
  return capability && capability !== 'unknown' ? capability : nameCapability
}

export function readCachedPromptOptimizationModels(profile: ApiProfile): PromptOptimizationModel[] {
  return cache.get(profile)?.models ?? []
}

export async function fetchPromptOptimizationModels(
  profile: ApiProfile,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<PromptOptimizationModel[]> {
  if (options.signal?.aborted) throw new DOMException('请求已停止', 'AbortError')
  // 先验证配置，即使 OpenRouter 公共目录不需要密钥，也不能掩盖不受支持的收件端。
  const endpoint = getPromptOptimizationRequestUrl(profile, 'models')
  const cached = cache.get(profile)
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return cached.models
  const controller = new AbortController()
  const abort = () => controller.abort(new DOMException('请求已停止', 'AbortError'))
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('文本模型目录请求超时，请重试', 'TimeoutError')), 20000)
  try {
    const initial = profile.provider === 'openrouter' ? OPENROUTER_TEXT_MODELS_URL : endpoint
    const origin = new URL(initial, 'https://same-origin.invalid')
    const seen = new Set<string>()
    const values: unknown[] = []
    let next: string | null = initial
    let total: number | undefined
    while (next) {
      if (controller.signal.aborted) throw controller.signal.reason
      if (seen.has(next) || seen.size >= 100) throw new PromptCatalogError('文本模型目录分页异常，请重试')
      seen.add(next)
      const response = await apiFetch(next, {
        headers: { Accept: 'application/json', ...(profile.provider === 'openai' && profile.apiKey.trim() ? { Authorization: `Bearer ${profile.apiKey.trim()}` } : {}) },
        credentials: 'omit',
        signal: controller.signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new PromptCatalogError(`文本模型目录请求失败（HTTP ${response.status}），请检查配置或稍后重试`)
      }
      let payload: unknown
      try { payload = await response.json() } catch { throw new PromptCatalogError('文本模型目录返回了无法解析的 JSON 数据') }
      if (!isRecord(payload) || payload.error || !Array.isArray(payload.data)) throw new PromptCatalogError('文本模型目录格式无法识别')
      values.push(...payload.data)
      if (typeof payload.total_count === 'number') total = payload.total_count
      const links = isRecord(payload.links) ? payload.links : {}
      const rawNext = typeof links.next === 'string' && links.next.trim() ? links.next : null
      if (rawNext) {
        const parsed: URL = new URL(rawNext, new URL(next, origin))
        if (parsed.origin !== origin.origin || parsed.pathname !== origin.pathname || parsed.username || parsed.password) throw new PromptCatalogError('文本模型目录分页地址无效')
        next = initial.startsWith('/') ? `${parsed.pathname}${parsed.search}` : parsed.href
      } else {
        next = null
        if (payload.has_more === true) throw new PromptCatalogError('文本模型目录返回不完整，请刷新重试')
      }
    }
    if (total !== undefined && values.length < total) throw new PromptCatalogError('文本模型目录返回不完整，请刷新重试')
    if (controller.signal.aborted) throw controller.signal.reason
    const models = normalizePromptOptimizationModels(values, profile.provider as 'openai' | 'openrouter')
    cache.set(profile, { at: Date.now(), models })
    return models
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    // 上游错误可能回显密钥、请求地址或提示词，不向 UI 透传这些内容。
    if (error instanceof PromptCatalogError) throw error
    throw new PromptCatalogError('文本模型目录连接失败，请检查网络、跨域和代理设置')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
