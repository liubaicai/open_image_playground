import { getApiErrorMessage } from '../../lib/imageApiShared'
import { apiFetch } from '../../lib/platform'
import type { OpenRouterImageEndpoint, OpenRouterImageModel, OpenRouterImagePrice, OpenRouterParameter } from './types'

export type { OpenRouterImageEndpoint, OpenRouterImageModel, OpenRouterImagePrice, OpenRouterModel, OpenRouterParameter } from './types'

export const OPENROUTER_CATALOG_URL = 'https://openrouter.ai/api/frontend/v1/models/find?order=newest'
export const OPENROUTER_PUBLIC_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image'
export const OPENROUTER_IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

const CACHE_MS = 5 * 60 * 1000
let cachedModels: OpenRouterImageModel[] = []
let cachedAt = 0
const subscribers = new Set<() => void>()
const endpointCache = new Map<string, { time: number; endpoints: OpenRouterImageEndpoint[] }>()

interface FetchOptions {
  signal?: AbortSignal
  force?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parameters(value: unknown): Record<string, OpenRouterParameter> {
  if (!isRecord(value)) return {}
  const result: Record<string, OpenRouterParameter> = {}
  for (const [key, descriptor] of Object.entries(value)) {
    if (!isRecord(descriptor)) continue
    if (descriptor.type === 'enum') result[key] = { type: 'enum', values: stringList(descriptor.values) }
    if (descriptor.type === 'boolean') result[key] = { type: 'boolean' }
    if (descriptor.type === 'range' && typeof descriptor.min === 'number' && typeof descriptor.max === 'number'
      && Number.isFinite(descriptor.min) && Number.isFinite(descriptor.max) && descriptor.min <= descriptor.max) {
      result[key] = { type: 'range', min: descriptor.min, max: descriptor.max }
    }
  }
  return result
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new DOMException('OpenRouter 模型目录请求超时', 'TimeoutError')), 20000)
  try {
    const response = await apiFetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`OpenRouter 目录：${await getApiErrorMessage(response)}`)
    const payload: unknown = await response.json()
    if (isRecord(payload) && payload.error) throw new Error('OpenRouter 目录返回错误，请稍后刷新')
    return payload
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

async function fetchCatalogPages(url: string, source: 'frontend' | 'public', signal?: AbortSignal): Promise<unknown[]> {
  const all: unknown[] = []
  const seen = new Set<string>()
  let next: string | null = url
  let total: number | undefined
  while (next) {
    if (seen.has(next) || seen.size >= 100) throw new Error('OpenRouter 目录分页异常，请稍后刷新')
    seen.add(next)
    const payload = await fetchJson(next, signal)
    if (!isRecord(payload)) throw new Error('OpenRouter 目录格式无法识别')
    const data = isRecord(payload.data) ? payload.data : payload
    const items = source === 'frontend' ? data.models : payload.data
    if (!Array.isArray(items)) throw new Error('OpenRouter 目录缺少完整模型列表')
    all.push(...items)
    if (typeof data.total_count === 'number') total = data.total_count
    const links = isRecord(data.links) ? data.links : isRecord(payload.links) ? payload.links : {}
    next = typeof links.next === 'string' && links.next ? new URL(links.next, next).href : null
    if (next) {
      const parsed = new URL(next)
      const initial = new URL(url)
      if (parsed.origin !== initial.origin || parsed.pathname !== initial.pathname) throw new Error('OpenRouter 目录分页地址无效')
    }
    if (!next && (data.has_more === true || payload.has_more === true)) throw new Error('OpenRouter 目录分页不完整')
  }
  if (total !== undefined && all.length < total) throw new Error('OpenRouter 目录返回不完整，请稍后刷新')
  return all
}

/** Only explicit display units are safe: raw image_output uses provider-specific normalization. */
export function normalizeOpenRouterDisplayPricing(payload: unknown): OpenRouterImagePrice[] {
  if (!Array.isArray(payload)) return []
  const result: OpenRouterImagePrice[] = []
  const number = (value: unknown) => typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN
  for (const row of payload) {
    if (!isRecord(row) || typeof row.sku_label !== 'string' || row.isServerTool === true) continue
    const label = row.sku_label
    // Generic Input Price is not an additional text charge when a text-specific SKU exists.
    if (label === 'Input Price' && payload.some((entry) => isRecord(entry) && entry.sku_label === 'Text Input')) continue
    let billable = ({ 'Image Output': 'output_image', 'Image Input': 'input_image', 'Text Input': 'input_text', 'Text Output': 'output_text', 'Input Price': 'input_text', 'Output Price': 'output_text' } as Record<string, string>)[label]
    let variant: string | undefined
    if (label === 'High-Resolution Image Output' || label.startsWith('Image Output (')) {
      billable = 'output_image'
      variant = label
    }
    const unit = row.kind === 'token' && row.unitLabel === '/M tokens' && row.displayMultiplier === 1000000
      ? 'token'
      : row.kind === 'unit' && row.displayMultiplier === 1
        ? ({ '/image': 'image', '/megapixel': 'megapixel', '/request': 'request' } as Record<string, string>)[String(row.unitLabel)] : undefined
    if (!billable || !unit) continue
    // Display multiplier formats the UI, not the underlying rate: token prices are already USD/token.
    // Tier rows replace the headline 'from' price so a base rate cannot masquerade as a universal rate.
    const tiers = Array.isArray(row.tiers) && row.tiers.length ? row.tiers : undefined
    for (const entry of tiers ?? [row]) {
      if (!isRecord(entry)) continue
      const price = number(entry.price)
      const entryVariant = tiers ? (typeof entry.sku_label === 'string' && entry.sku_label.trim() ? entry.sku_label : undefined) : variant
      if (!Number.isFinite(price) || price < 0 || (tiers && !entryVariant)) continue
      result.push({ billable, unit, costUsd: price, ...(entryVariant ? { variant: entryVariant } : {}) })
    }
  }
  return result
}

export function normalizeOpenRouterImageModels(payload: unknown, source: 'frontend' | 'public' = 'frontend'): OpenRouterImageModel[] {
  const root = isRecord(payload) ? payload : {}
  const nested = isRecord(root.data) ? root.data : root
  const values = Array.isArray(payload) ? payload : Array.isArray(nested.models) ? nested.models : root.data
  if (!Array.isArray(values)) throw new Error('OpenRouter 目录格式无法识别')
  const models = new Map<string, OpenRouterImageModel>()
  for (const value of values) {
    if (!isRecord(value)) continue
    const architecture = isRecord(value.architecture) ? value.architecture : {}
    // 前端目录的 id 是内部标识；请求必须使用 slug。只按输出能力筛选，不能把视觉理解模型当生成模型。
    const id = source === 'frontend' && typeof value.slug === 'string' ? value.slug : value.id
    const outputModalities = stringList(value.output_modalities ?? architecture.output_modalities)
    if (typeof id !== 'string' || !id.trim() || !outputModalities.includes('image')) continue
    const endpoint = isRecord(value.endpoint) ? value.endpoint : {}
    const rawPricing = isRecord(value.pricing) ? value.pricing : isRecord(endpoint.pricing) ? endpoint.pricing : {}
    const pricing = Object.fromEntries(Object.entries(rawPricing)
      .filter(([, price]) => typeof price === 'string' || typeof price === 'number')
      .map(([key, price]) => [key, String(price)]))
    const displayPricing = normalizeOpenRouterDisplayPricing(endpoint.display_pricing ?? rawPricing.display_pricing)
      .filter((price) => price.billable !== 'output_text' || outputModalities.includes('text'))
    models.set(id, {
      id,
      name: typeof value.name === 'string' && value.name.trim() ? value.name : id,
      inputModalities: stringList(value.input_modalities ?? architecture.input_modalities),
      outputModalities,
      pricing,
      ...(source === 'frontend' && displayPricing.length ? { displayPricing, displayPricingSource: { label: 'OpenRouter 目录显示价格', url: OPENROUTER_CATALOG_URL } } : {}),
      description: typeof value.description === 'string' ? value.description : undefined,
      contextLength: typeof value.context_length === 'number' ? value.context_length : undefined,
      supportsImageApi: false,
      source,
    })
  }
  return [...models.values()]
}

export function readCachedOpenRouterImageModels(): OpenRouterImageModel[] {
  return cachedModels
}

export function subscribeOpenRouterImageModels(listener: () => void): () => void {
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

export async function fetchOpenRouterImageModels(options: FetchOptions = {}): Promise<OpenRouterImageModel[]> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('请求已停止', 'AbortError')
  if (!options.force && cachedAt && Date.now() - cachedAt < CACHE_MS) return cachedModels
  let source: 'frontend' | 'public' = 'frontend'
  let values: unknown[]
  try {
    values = await fetchCatalogPages(OPENROUTER_CATALOG_URL, source, options.signal)
  } catch (error) {
    if (options.signal?.aborted) throw error
    // 前端接口没有稳定性承诺；备用接口是官方文档公开的完整图像输出目录。
    source = 'public'
    values = await fetchCatalogPages(OPENROUTER_PUBLIC_MODELS_URL, source, options.signal)
  }
  const imagePayload = await fetchJson(OPENROUTER_IMAGE_MODELS_URL, options.signal)
  if (!isRecord(imagePayload) || !Array.isArray(imagePayload.data)) throw new Error('OpenRouter 图像能力目录格式无法识别')
  const capabilities = new Map(imagePayload.data.filter(isRecord)
    .filter((item) => typeof item.id === 'string')
    .map((item) => [item.id as string, item]))
  const models = normalizeOpenRouterImageModels(values, source)
  for (const model of models) {
    const capability = capabilities.get(model.id)
    model.supportsImageApi = Boolean(capability)
    if (capability) model.supportedParameters = parameters(capability.supported_parameters)
  }
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('请求已停止', 'AbortError')
  cachedModels = models
  cachedAt = Date.now()
  subscribers.forEach((listener) => listener())
  return cachedModels
}

export async function fetchOpenRouterImageModelEndpoints(modelId: string, options: FetchOptions = {}): Promise<OpenRouterImageEndpoint[]> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('请求已停止', 'AbortError')
  const cached = endpointCache.get(modelId)
  if (!options.force && cached && Date.now() - cached.time < CACHE_MS) return cached.endpoints
  const path = modelId.split('/').map(encodeURIComponent).join('/')
  const payload = await fetchJson(`${OPENROUTER_IMAGE_MODELS_URL}/${path}/endpoints`, options.signal)
  if (!isRecord(payload) || !Array.isArray(payload.endpoints)) throw new Error('OpenRouter 模型价格格式无法识别')
  const endpoints = payload.endpoints.filter(isRecord).map((value): OpenRouterImageEndpoint => {
    const pricing: OpenRouterImagePrice[] = []
    for (const item of Array.isArray(value.pricing) ? value.pricing : []) {
      if (!isRecord(item) || typeof item.billable !== 'string' || typeof item.unit !== 'string'
        || typeof item.cost_usd !== 'number' || !Number.isFinite(item.cost_usd) || item.cost_usd < 0) continue
      pricing.push({ billable: item.billable, unit: item.unit, costUsd: item.cost_usd,
        ...(typeof item.variant === 'string' ? { variant: item.variant } : {}) })
    }
    return {
      providerName: typeof value.provider_name === 'string' ? value.provider_name : '',
      providerSlug: typeof value.provider_slug === 'string' ? value.provider_slug : '',
      ...(typeof value.provider_tag === 'string' ? { providerTag: value.provider_tag } : {}),
      supportedParameters: parameters(value.supported_parameters),
      pricing,
    }
  })
  endpointCache.set(modelId, { time: Date.now(), endpoints })
  return endpoints
}
