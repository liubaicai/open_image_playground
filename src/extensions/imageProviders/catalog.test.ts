import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOpenRouterImageModelEndpoints,
  fetchOpenRouterImageModels,
  normalizeOpenRouterImageModels,
  normalizeOpenRouterDisplayPricing,
  OPENROUTER_CATALOG_URL,
  OPENROUTER_IMAGE_MODELS_URL,
  OPENROUTER_PUBLIC_MODELS_URL,
  readCachedOpenRouterImageModels,
  subscribeOpenRouterImageModels,
} from './catalog'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const frontend = { data: { models: [
  { id: 'internal-123', slug: 'maker/image', name: 'Image', input_modalities: ['text'], output_modalities: ['image'], endpoint: { pricing: { image_output: '0.00003', prompt: 0.000001 } } },
  { slug: 'maker/vision', input_modalities: ['text', 'image'], output_modalities: ['text'] },
  { slug: 'maker/retired', output_modalities: ['image'], endpoint: null },
] } }
const imageModels = { data: [{ id: 'maker/image', supported_parameters: { n: { type: 'range', min: 1, max: 1 }, quality: { type: 'enum', values: ['high'] } } }] }

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouter model catalog', () => {
  it('preserves explicit Muse display pricing from either frontend location, without interpreting raw image_output', () => {
    const display = [{ kind: 'unit', sku_label: 'Image Output', price: '0.01', displayMultiplier: 1, unitLabel: '/image' }]
    for (const endpoint of [{ display_pricing: display }, { pricing: { image_output: '0.000002', prompt: '0', display_pricing: display } }]) {
      const [model] = normalizeOpenRouterImageModels([{ slug: 'meta/muse-image', output_modalities: ['image'], endpoint }])
      expect(model.displayPricing).toEqual([{ billable: 'output_image', unit: 'image', costUsd: 0.01 }])
      expect(model.displayPricingSource?.url).toBe(OPENROUTER_CATALOG_URL)
    }
  })

  it('rejects ambiguous display units, multipliers, invalid and negative prices', () => {
    const base = { kind: 'unit', sku_label: 'Image Output', price: '0.01', displayMultiplier: 1, unitLabel: '/image' }
    expect(normalizeOpenRouterDisplayPricing([
      { ...base, unitLabel: '/unknown' }, { ...base, displayMultiplier: 1000 },
      { ...base, price: '' }, { ...base, price: '-1' }, { ...base, price: 'NaN' },
      { ...base, sku_label: 'Unknown' }, { ...base, kind: 'tiered' },
    ])).toEqual([])
    expect(normalizeOpenRouterDisplayPricing([{ ...base, unitLabel: '/megapixel' }, { ...base, unitLabel: '/request', price: 0 }])).toEqual([
      { billable: 'output_image', unit: 'megapixel', costUsd: 0.01 }, { billable: 'output_image', unit: 'request', costUsd: 0 },
    ])
  })

  it('keeps token rates in USD/token and preserves resolution and conditional output alternatives', () => {
    expect(normalizeOpenRouterDisplayPricing([
      { kind: 'token', sku_label: 'Image Output', price: '0.00003', displayMultiplier: 1000000, unitLabel: '/M tokens' },
      { kind: 'unit', sku_label: 'Image Output', price: '0.04', displayMultiplier: 1, unitLabel: '/image', tiers: [{ sku_label: '1K', price: '0.04' }, { sku_label: '2K', price: '0.075' }] },
      { kind: 'unit', sku_label: 'High-Resolution Image Output', price: '0.09', displayMultiplier: 1, unitLabel: '/image' },
      { kind: 'unit', sku_label: 'Image Output (style references)', price: '0.065', displayMultiplier: 1, unitLabel: '/image' },
      { kind: 'unit', sku_label: 'Web Search', price: '0.014', displayMultiplier: 1000, unitLabel: '/1K calls', isServerTool: true },
    ])).toEqual([
      { billable: 'output_image', unit: 'token', costUsd: 0.00003 },
      { billable: 'output_image', unit: 'image', costUsd: 0.04, variant: '1K' },
      { billable: 'output_image', unit: 'image', costUsd: 0.075, variant: '2K' },
      { billable: 'output_image', unit: 'image', costUsd: 0.09, variant: 'High-Resolution Image Output' },
      { billable: 'output_image', unit: 'image', costUsd: 0.065, variant: 'Image Output (style references)' },
    ])
  })

  it('prefers text-specific input SKU and does not charge text output on image-only models', () => {
    const row = (sku_label: string, price: string) => ({ kind: 'token', sku_label, price, displayMultiplier: 1000000, unitLabel: '/M tokens' })
    const [model] = normalizeOpenRouterImageModels([{ slug: 'maker/image', output_modalities: ['image'], endpoint: { display_pricing: [row('Input Price', '0.000008'), row('Text Input', '0.000005'), row('Output Price', '0.000008'), row('Image Output', '0.00003')] } }])
    expect(model.displayPricing).toEqual([{ billable: 'input_text', unit: 'token', costUsd: 0.000005 }, { billable: 'output_image', unit: 'token', costUsd: 0.00003 }])
  })

  it('reads nested full frontend response, uses slug, and excludes vision-only models', () => {
    const models = normalizeOpenRouterImageModels(frontend)
    expect(models.map((model) => model.id)).toEqual(['maker/image', 'maker/retired'])
    expect(models[0].pricing).toEqual({ image_output: '0.00003', prompt: '0.000001' })
    expect(models[0].outputModalities).toEqual(['image'])
  })

  it('does not infer output support from a name, input capability, or missing metadata', () => {
    expect(normalizeOpenRouterImageModels({ data: [
      { id: 'image-name', architecture: { input_modalities: ['image'] } },
      { id: 'vision', architecture: { input_modalities: ['image'], output_modalities: ['text'] } },
      { id: 'output', architecture: { input_modalities: ['image'], output_modalities: ['image', 'text'] } },
    ] }, 'public').map((model) => model.id)).toEqual(['output'])
  })

  it('keeps all catalog entries and verifies available dedicated image API models', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(frontend)).mockResolvedValueOnce(json(imageModels))
    vi.stubGlobal('fetch', fetch)
    const listener = vi.fn()
    const unsubscribe = subscribeOpenRouterImageModels(listener)
    const models = await fetchOpenRouterImageModels({ force: true })
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([OPENROUTER_CATALOG_URL, OPENROUTER_IMAGE_MODELS_URL])
    expect(models[0].supportsImageApi).toBe(true)
    expect(models[0].supportedParameters?.n).toEqual({ type: 'range', min: 1, max: 1 })
    expect(models[1].supportsImageApi).toBe(false)
    expect(readCachedOpenRouterImageModels()).toBe(models)
    expect(await fetchOpenRouterImageModels()).toBe(models)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', headers: { Accept: 'application/json' } })
    unsubscribe()
  })

  it('loads the whole list rather than an arbitrary first page or slice', async () => {
    const values = Array.from({ length: 1200 }, (_, index) => ({ slug: `maker/model-${index}`, output_modalities: ['image'] }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ data: { models: values } })).mockResolvedValueOnce(json({ data: [] })))
    expect(await fetchOpenRouterImageModels({ force: true })).toHaveLength(1200)
  })

  it('falls back honestly to documented public model API and follows its next links', async () => {
    const next = `${OPENROUTER_PUBLIC_MODELS_URL}&offset=1`
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'down' } }, 503))
      .mockResolvedValueOnce(json({ data: [{ id: 'maker/image', architecture: { output_modalities: ['image'] } }], total_count: 2, links: { next } }))
      .mockResolvedValueOnce(json({ data: [{ id: 'maker/second', architecture: { output_modalities: ['image'] } }], total_count: 2, links: { next: null } }))
      .mockResolvedValueOnce(json(imageModels))
    vi.stubGlobal('fetch', fetch)
    const models = await fetchOpenRouterImageModels({ force: true })
    expect(models.map((model) => model.id)).toEqual(['maker/image', 'maker/second'])
    expect(models.every((model) => model.source === 'public')).toBe(true)
    expect(fetch.mock.calls[2][0]).toBe(next)
  })

  it('rejects a partial public response rather than claiming a complete catalog', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ data: [], total_count: 4, links: { next: null } })))
    await expect(fetchOpenRouterImageModels({ force: true })).rejects.toThrow('不完整')
  })

  it('does not follow cross-origin pagination links', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ data: [], links: { next: 'https://attacker.invalid/models' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchOpenRouterImageModels({ force: true })).rejects.toThrow('分页地址无效')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('aborts without initiating fallback or changing the cache', async () => {
    const controller = new AbortController()
    const fetch = vi.fn().mockImplementation(() => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    vi.stubGlobal('fetch', fetch)
    const before = readCachedOpenRouterImageModels()
    await expect(fetchOpenRouterImageModels({ signal: controller.signal, force: true })).rejects.toThrow('aborted')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(readCachedOpenRouterImageModels()).toBe(before)
  })

  it('normalizes explicit endpoint billables and does not invent units or accept invalid prices', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ endpoints: [{
      provider_name: 'Seed', provider_slug: 'seed', provider_tag: 'seed',
      supported_parameters: { n: { type: 'range', min: 1, max: 10 }, seed: { type: 'boolean' } },
      pricing: [
        { billable: 'output_image', unit: 'image', cost_usd: 0.04 },
        { billable: 'input_image', unit: 'image', cost_usd: 0 },
        { billable: 'output_image', unit: 'token', cost_usd: -1 },
        { billable: 'output_image', cost_usd: 1 },
      ],
    }] }))
    vi.stubGlobal('fetch', fetch)
    const endpoints = await fetchOpenRouterImageModelEndpoints('bytedance-seed/seedream-4.5', { force: true })
    expect(fetch.mock.calls[0][0]).toBe(`${OPENROUTER_IMAGE_MODELS_URL}/bytedance-seed/seedream-4.5/endpoints`)
    expect(endpoints[0].pricing).toEqual([{ billable: 'output_image', unit: 'image', costUsd: 0.04 }, { billable: 'input_image', unit: 'image', costUsd: 0 }])
    expect(await fetchOpenRouterImageModelEndpoints('bytedance-seed/seedream-4.5')).toBe(endpoints)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
