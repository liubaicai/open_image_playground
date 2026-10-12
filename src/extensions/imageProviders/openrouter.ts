import type { ApiProfile, TaskParams } from '../../types'
import { resolveApiProfileModel } from '../../lib/apiProfiles'
import { apiFetch } from '../../lib/platform'
import {
  assertImageInputPayloadSize,
  createRequestTimeoutError,
  getApiErrorMessage,
  type CallApiOptions,
  type CallApiResult,
} from '../../lib/imageApiShared'
import { fetchOpenRouterImageModels, OPENROUTER_BASE_URL } from './catalog'

function imageDataUrl(value: unknown, mediaType: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('OpenRouter 返回了空图片数据')
  const data = value.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
  const base64 = (data?.[2] ?? value).replace(/\s/g, '')
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) throw new Error('OpenRouter 返回了无效的 Base64 图片数据')
  let head: string
  try {
    head = atob(base64.slice(0, Math.min(base64.length, 1024)))
  } catch {
    throw new Error('OpenRouter 返回了无效的 Base64 图片数据')
  }
  let mime = typeof mediaType === 'string' ? mediaType.trim().toLowerCase() : data?.[1]?.toLowerCase()
  if (mime && !/^image\/[a-z0-9.+-]+$/.test(mime)) throw new Error('OpenRouter 返回了非图像媒体类型')
  // 未提供 media_type 时按真实签名识别，不能把 JPEG、WebP 或矢量图冒充 PNG。
  if (!mime) {
    if (head.startsWith('\x89PNG\r\n\x1a\n')) mime = 'image/png'
    else if (head.startsWith('\xff\xd8\xff')) mime = 'image/jpeg'
    else if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') mime = 'image/webp'
    else if (/^GIF8[79]a/.test(head)) mime = 'image/gif'
    else if (/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) mime = 'image/svg+xml'
    else throw new Error('OpenRouter 未提供图片媒体类型，且图片格式无法识别')
  }
  return `data:${mime};base64,${base64}`
}

export async function callOpenRouterImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  // 导入配置也必须经过校验，不能把 OpenRouter 密钥发给任意自定义地址。
  const base = profile.baseUrl.trim().replace(/\/+$/, '') || OPENROUTER_BASE_URL
  if (base !== OPENROUTER_BASE_URL) throw new Error('OpenRouter 仅支持官方 API 地址 https://openrouter.ai/api/v1')
  if (!profile.apiKey.trim()) throw new Error('请先填写 OpenRouter API Key')
  if (opts.maskDataUrl) throw new Error('OpenRouter 图像 API 暂不支持遮罩编辑；请移除遮罩后使用参考图')
  if (!Number.isInteger(opts.params.n) || opts.params.n < 1 || opts.params.n > 10) throw new Error('OpenRouter 图片数量应为 1–10 张')
  const modelId = resolveApiProfileModel(profile).model.trim()
  if (!modelId) throw new Error('请先启用并选择一个 OpenRouter 图像模型')
  assertImageInputPayloadSize(opts.inputImageDataUrls.reduce((sum, url) => sum + url.length, 0))

  const controller = new AbortController()
  const timeoutSeconds = profile.timeout > 0 && Number.isFinite(profile.timeout) ? profile.timeout : 600
  const timeout = setTimeout(() => controller.abort(createRequestTimeoutError(timeoutSeconds)), timeoutSeconds * 1000)
  try {
    const catalog = await fetchOpenRouterImageModels({ signal: controller.signal })
    const model = catalog.find((item) => item.id === modelId)
    if (!model?.supportsImageApi) throw new Error('所选模型目前不支持 OpenRouter 图像 API，请刷新目录并选择可用模型')
    const supported = model.supportedParameters ?? {}
    const refs = supported.input_references
    if (refs?.type === 'range' && opts.inputImageDataUrls.length < refs.min) throw new Error(`此模型至少需要 ${refs.min} 张参考图`)
    if (opts.inputImageDataUrls.length) {
      if (!model.inputModalities.includes('image') || !refs) throw new Error('此模型不支持参考图，请移除图片或选择支持图像输入的生成模型')
      if (refs.type === 'range' && opts.inputImageDataUrls.length > refs.max) throw new Error(`此模型最多支持 ${refs.max} 张参考图`)
      if (opts.inputImageDataUrls.some((url) => !/^data:image\/[a-z0-9.+-]+;base64,/i.test(url) && !/^https?:\/\//i.test(url))) {
        throw new Error('参考图必须为图像 Base64 data URL 或 HTTP(S) 地址')
      }
    }
    const body: Record<string, unknown> = { model: modelId, prompt: opts.prompt, stream: false }
    if (opts.params.size !== 'auto') body.size = opts.params.size
    if (opts.inputImageDataUrls.length) body.input_references = opts.inputImageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
    if (opts.params.quality !== 'auto' && supported.quality?.type === 'enum') {
      if (!supported.quality.values.includes(opts.params.quality)) throw new Error('此模型不支持所选画质，请选择自动画质或支持的档位')
      body.quality = opts.params.quality
    }
    if (supported.output_format?.type === 'enum' && supported.output_format.values.some((value) => ['png', 'jpeg', 'webp'].includes(value))) {
      if (!supported.output_format.values.includes(opts.params.output_format)) throw new Error('此模型不支持所选输出格式')
      body.output_format = opts.params.output_format
    }
    if (opts.params.output_compression !== null && supported.output_compression && (body.output_format === 'jpeg' || body.output_format === 'webp')) {
      body.output_compression = opts.params.output_compression
    }
    if (opts.nativeTransparentBackground) {
      if (supported.background?.type !== 'enum' || !supported.background.values.includes('transparent')) {
        throw new Error('此模型不支持原生透明背景，请切换为本地后处理')
      }
      if (body.output_format === 'jpeg') throw new Error('透明背景需要 PNG 或 WebP 输出格式')
      body.background = 'transparent'
    }

    const maxPerRequest = supported.n?.type === 'range' ? Math.min(10, Math.max(1, Math.floor(supported.n.max))) : 1
    const minPerRequest = supported.n?.type === 'range' ? Math.max(1, Math.ceil(supported.n.min)) : 1
    const requestCount = Math.ceil(opts.params.n / maxPerRequest)
    const perRequest = Math.floor(opts.params.n / requestCount)
    if (perRequest < minPerRequest) throw new Error(`此模型每次需要 ${minPerRequest}–${maxPerRequest} 张图片，请调整数量`)
    const requests: Array<{ count: number; index: number }> = []
    for (let index = 0; index < opts.params.n;) {
      const count = perRequest + (requests.length < opts.params.n % requestCount ? 1 : 0)
      requests.push({ index, count })
      index += count
    }
    // 单图模型以多个独立请求满足数量；没有自动重试，避免在状态不明时重复计费。
    const results = await Promise.allSettled(requests.map(async (request) => {
      const response = await apiFetch(`${OPENROUTER_BASE_URL}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${profile.apiKey.trim()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...body, ...(supported.n ? { n: request.count } : {}) }),
        signal: controller.signal,
        credentials: 'omit',
      })
      if (!response.ok) throw new Error(`OpenRouter：${await getApiErrorMessage(response)}`)
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        if (controller.signal.aborted) throw controller.signal.reason
        throw new Error('OpenRouter 返回了无法解析的 JSON 数据')
      }
      if (!payload || typeof payload !== 'object') throw new Error('OpenRouter 返回了无效响应')
      const record = payload as Record<string, unknown>
      if (record.error) {
        const error = record.error as { message?: unknown }
        throw new Error(`OpenRouter：${typeof error.message === 'string' ? error.message : typeof record.error === 'string' ? record.error : '图片生成失败'}`)
      }
      if (!Array.isArray(record.data) || !record.data.length) throw new Error('OpenRouter 未返回图片数据')
      return record.data.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('OpenRouter 返回了无效图片数据')
        const image = item as Record<string, unknown>
        return imageDataUrl(image.b64_json, image.media_type)
      })
    }))
    const images = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    if (!images.length) {
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      throw failed?.reason ?? new Error('OpenRouter 未返回图片数据')
    }
    const failedRequests = results.flatMap((result, index) => {
      const returned = result.status === 'fulfilled' ? result.value.length : 0
      return Array.from({ length: Math.max(0, requests[index].count - returned) }, (_, offset) => ({
        requestIndex: requests[index].index + returned + offset,
        error: result.status === 'rejected'
          ? result.reason instanceof Error ? result.reason.message.split(profile.apiKey.trim()).join('[已隐藏密钥]') : 'OpenRouter 图片生成失败'
          : `OpenRouter 本次请求 ${requests[index].count} 张但仅返回 ${returned} 张；未自动补发请求`,
      }))
    })
    const actualParamsList = images.map((image): Partial<TaskParams> => {
      const mime = image.slice(5, image.indexOf(';'))
      const output_format = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpeg' : mime === 'image/webp' ? 'webp' : undefined
      return output_format ? { output_format } : {}
    })
    return {
      images,
      actualParams: { n: images.length },
      actualParamsList,
      ...(failedRequests.length ? { failedRequests } : {}),
    }
  } catch (error) {
    // 某些兼容端点会原样回显密钥；错误可持久化到历史记录，先脱敏。
    if (error instanceof Error && profile.apiKey.trim() && error.message.includes(profile.apiKey.trim())) {
      throw new Error(error.message.split(profile.apiKey.trim()).join('[已隐藏密钥]'))
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
