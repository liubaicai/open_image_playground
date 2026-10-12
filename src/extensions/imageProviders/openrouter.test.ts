import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiProfile } from '../../types'
import { DEFAULT_SETTINGS } from '../../lib/apiProfiles'
import { callImageApi } from '../../lib/api'
import type { CallApiOptions } from '../../lib/imageApiShared'
import { apiFetch } from '../../lib/platform'
import { fetchOpenRouterImageModels, OPENROUTER_BASE_URL, type OpenRouterImageModel } from './catalog'
import { callOpenRouterImageApi } from './openrouter'

vi.mock('../../lib/platform', () => ({ apiFetch: vi.fn(), isTauri: false }))
vi.mock('./catalog', () => ({ fetchOpenRouterImageModels: vi.fn(), OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1' }))

const profile: ApiProfile = {
  id: 'router', name: 'OpenRouter', provider: 'openrouter', baseUrl: OPENROUTER_BASE_URL,
  apiKey: 'test-secret-key', model: 'maker/image', timeout: 30, apiMode: 'images',
  codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local',
}
const opts: CallApiOptions = { settings: DEFAULT_SETTINGS, prompt: 'A bird', params: DEFAULT_PARAMS, inputImageDataUrls: [] }
const model: OpenRouterImageModel = {
  id: 'maker/image', name: 'Image', inputModalities: ['text', 'image'], outputModalities: ['image'],
  pricing: {}, source: 'frontend', supportsImageApi: true,
  supportedParameters: {
    n: { type: 'range', min: 1, max: 10 },
    input_references: { type: 'range', min: 0, max: 3 },
    quality: { type: 'enum', values: ['low', 'medium', 'high'] },
    output_format: { type: 'enum', values: ['png', 'webp', 'jpeg'] },
    output_compression: { type: 'range', min: 0, max: 100 },
  },
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const result = (media_type = 'image/png') => json({ data: [{ b64_json: 'aW1hZ2U=', media_type }] })
const requestBody = (index = 0) => JSON.parse(vi.mocked(apiFetch).mock.calls[index][1]?.body as string)

beforeEach(() => {
  vi.mocked(fetchOpenRouterImageModels).mockResolvedValue([model])
  vi.mocked(apiFetch).mockImplementation(async () => result())
})
afterEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('OpenRouter image adapter', () => {
  it('routes the existing image API entrypoint to OpenRouter with the selected profile', async () => {
    const settings = { ...DEFAULT_SETTINGS, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, profiles: [profile], activeProfileId: profile.id }
    const response = await callImageApi({ ...opts, settings })
    expect(response.images).toHaveLength(1)
    expect(apiFetch).toHaveBeenCalledWith(`${OPENROUTER_BASE_URL}/images`, expect.anything())
    expect(requestBody().model).toBe('maker/image')
  })

  it('uses the official dedicated API, bearer auth, and explicit image output data', async () => {
    const response = await callOpenRouterImageApi(opts, profile)
    expect(apiFetch).toHaveBeenCalledWith(`${OPENROUTER_BASE_URL}/images`, expect.objectContaining({
      method: 'POST', credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer test-secret-key' }),
    }))
    expect(requestBody()).toEqual({ model: 'maker/image', prompt: 'A bird', stream: false, n: 1, output_format: 'png' })
    expect(response.images).toEqual(['data:image/png;base64,aW1hZ2U='])
    expect(response.actualParamsList).toEqual([{ output_format: 'png' }])
  })

  it('keeps an effective profile model when stale selectedModel points to a disabled model', async () => {
    await callOpenRouterImageApi(opts, { ...profile, selectedModel: 'disabled/model' })
    expect(requestBody().model).toBe('maker/image')
  })

  it('uses selected enabled model from a profile model list', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValue([model, { ...model, id: 'maker/second' }])
    await callOpenRouterImageApi(opts, { ...profile, model: 'maker/image, maker/second', selectedModel: 'maker/second' })
    expect(requestBody().model).toBe('maker/second')
  })

  it('sends reference images, exact pixel shorthand, and supported image controls', async () => {
    const image = 'data:image/png;base64,aW1hZ2U='
    await callOpenRouterImageApi({ ...opts, inputImageDataUrls: [image], params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high', output_format: 'webp', output_compression: 80 } }, profile)
    expect(requestBody()).toMatchObject({
      input_references: [{ type: 'image_url', image_url: { url: image } }],
      size: '1536x1024', quality: 'high', output_format: 'webp', output_compression: 80,
    })
    expect(requestBody()).not.toHaveProperty('messages')
    expect(requestBody()).not.toHaveProperty('moderation')
  })

  it('splits single-image models into exactly the requested number of paid requests', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValue([{ ...model, supportedParameters: { n: { type: 'range', min: 1, max: 1 } } }])
    const response = await callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, n: 3 } }, profile)
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(response.images).toHaveLength(3)
    expect(response.actualParams?.n).toBe(3)
    expect([requestBody(0).n, requestBody(1).n, requestBody(2).n]).toEqual([1, 1, 1])
  })

  it('balances split requests to honor both minimum and maximum counts', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValue([{ ...model, supportedParameters: { n: { type: 'range', min: 2, max: 4 } } }])
    vi.mocked(apiFetch).mockImplementation(async (_, init) => json({ data: Array.from({ length: JSON.parse(init?.body as string).n }, () => ({ b64_json: 'aW1hZ2U=', media_type: 'image/png' })) }))
    expect((await callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, n: 5 } }, profile)).images).toHaveLength(5)
    expect([requestBody(0).n, requestBody(1).n]).toEqual([3, 2])
    vi.mocked(apiFetch).mockClear()
    await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow('每次需要 2–4')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('retains partial successes and redacts keys from failed request records', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValue([{ ...model, supportedParameters: { n: { type: 'range', min: 1, max: 1 } } }])
    vi.mocked(apiFetch).mockResolvedValueOnce(result()).mockResolvedValueOnce(json({ error: { message: 'Invalid key test-secret-key' } }, 401))
    const response = await callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, n: 2 } }, profile)
    expect(response.images).toHaveLength(1)
    expect(response.failedRequests).toEqual([{ requestIndex: 1, error: 'OpenRouter：Invalid key [已隐藏密钥]' }])
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('reports returned count and missing slots without silently retrying short provider output', async () => {
    const response = await callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, n: 3 } }, profile)
    expect(response.actualParams?.n).toBe(1)
    expect(response.failedRequests?.map((failure) => failure.requestIndex)).toEqual([1, 2])
    expect(response.failedRequests?.[0].error).toContain('未自动补发')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('honors returned media types and sniffs missing PNG, JPEG, WebP, GIF and SVG types', async () => {
    const samples = [
      ['\x89PNG\r\n\x1a\n', 'image/png'], ['\xff\xd8\xffx', 'image/jpeg'],
      ['RIFF1234WEBP', 'image/webp'], ['GIF89a', 'image/gif'], ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'image/svg+xml'],
    ]
    vi.mocked(apiFetch).mockResolvedValueOnce(result('image/webp'))
    expect((await callOpenRouterImageApi(opts, profile)).images[0]).toMatch(/^data:image\/webp/)
    for (const [bytes, mime] of samples) {
      vi.mocked(apiFetch).mockResolvedValueOnce(json({ data: [{ b64_json: btoa(bytes) }] }))
      expect((await callOpenRouterImageApi(opts, profile)).images[0]).toBe(`data:${mime};base64,${btoa(bytes)}`)
    }
  })

  it('does not assume PNG or accept invalid base64/non-image types', async () => {
    for (const image of [{ b64_json: 'aW1hZ2U=' }, { b64_json: 'invalid??', media_type: 'image/png' }, { b64_json: 'aW1hZ2U=', media_type: 'text/html' }]) {
      vi.mocked(apiFetch).mockResolvedValueOnce(json({ data: [image] }))
      await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow()
    }
  })

  it('lets SVG-only models use their default format rather than sending an unsupported raster format', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValueOnce([{ ...model, supportedParameters: { output_format: { type: 'enum', values: ['svg'] } } }])
    vi.mocked(apiFetch).mockResolvedValueOnce(json({ data: [{ b64_json: btoa('<svg></svg>'), media_type: 'image/svg+xml' }] }))
    const response = await callOpenRouterImageApi(opts, profile)
    expect(requestBody()).not.toHaveProperty('output_format')
    expect(response.images[0]).toBe(`data:image/svg+xml;base64,${btoa('<svg></svg>')}`)
  })

  it('surfaces HTTP errors, successful-status errors, malformed JSON and missing image data', async () => {
    for (const response of [json({ error: { message: 'no credits' } }, 402), json({ error: { message: 'no credits' } }), new Response('invalid-json'), json({ data: [] })]) {
      vi.mocked(apiFetch).mockResolvedValueOnce(response)
      await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow()
    }
    expect(apiFetch).toHaveBeenCalledTimes(4)
  })

  it('redacts a key from an all-failed error without logging payloads', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json({ error: { message: 'Invalid key test-secret-key' } }, 401))
    await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow('Invalid key [已隐藏密钥]')
  })

  it('blocks unsafe base URLs, missing keys, masks and invalid counts before any request', async () => {
    await expect(callOpenRouterImageApi(opts, { ...profile, baseUrl: 'https://untrusted.example/v1' })).rejects.toThrow('仅支持官方')
    await expect(callOpenRouterImageApi(opts, { ...profile, apiKey: '' })).rejects.toThrow('API Key')
    await expect(callOpenRouterImageApi({ ...opts, maskDataUrl: 'data:image/png;base64,aW1hZ2U=' }, profile)).rejects.toThrow('遮罩')
    for (const n of [0, 1.5, 11]) await expect(callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, n } }, profile)).rejects.toThrow('数量')
    expect(apiFetch).not.toHaveBeenCalled()
    expect(fetchOpenRouterImageModels).not.toHaveBeenCalled()
  })

  it('prevents generation with unavailable models and reference-incompatible models', async () => {
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValueOnce([{ ...model, supportsImageApi: false }])
    await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow('不支持 OpenRouter')
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValueOnce([{ ...model, inputModalities: ['text'] }])
    await expect(callOpenRouterImageApi({ ...opts, inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='] }, profile)).rejects.toThrow('不支持参考图')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('validates reference count, quality and native transparency', async () => {
    await expect(callOpenRouterImageApi({ ...opts, inputImageDataUrls: Array(4).fill('data:image/png;base64,aW1hZ2U=') }, profile)).rejects.toThrow('最多支持 3')
    await expect(callOpenRouterImageApi({ ...opts, params: { ...DEFAULT_PARAMS, quality: 'max' } }, profile)).rejects.toThrow('不支持所选画质')
    await expect(callOpenRouterImageApi({ ...opts, nativeTransparentBackground: true }, profile)).rejects.toThrow('原生透明背景')
    vi.mocked(fetchOpenRouterImageModels).mockResolvedValueOnce([{ ...model, supportedParameters: { input_references: { type: 'range', min: 1, max: 1 } } }])
    await expect(callOpenRouterImageApi(opts, profile)).rejects.toThrow('至少需要 1')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('times out with the shared actionable abort error', async () => {
    vi.useFakeTimers()
    vi.mocked(apiFetch).mockImplementation((_, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    const promise = callOpenRouterImageApi(opts, { ...profile, timeout: 1 })
    const expectation = expect(promise).rejects.toThrow('请求超时：超过 1 秒')
    await vi.advanceTimersByTimeAsync(1001)
    await expectation
  })
})
