import { describe, expect, it } from 'vitest'
import type { OpenRouterImageEndpoint, OpenRouterImageModel, OpenRouterImagePrice } from './catalog'
import { describeOpenRouterPricing, estimateOpenRouterCost, formatEstimatedUsd, formatUsd } from './pricing'

const model: OpenRouterImageModel = { id: 'maker/image', name: 'Image', inputModalities: ['text'], outputModalities: ['image'], pricing: {}, supportsImageApi: true, source: 'frontend' }
const endpoint = (pricing: OpenRouterImagePrice[]): OpenRouterImageEndpoint => ({ providerName: 'Provider', providerSlug: 'provider', pricing, supportedParameters: {} })

describe('honest OpenRouter pricing', () => {
  it('converts documented per-token text rates to USD per million tokens only', () => {
    expect(describeOpenRouterPricing({ ...model, pricing: { prompt: '0.000002', completion: '0.000008', image_output: '0.00004' } }))
      .toEqual(['输入文本 $2 / 百万 token', '输出文本 $8 / 百万 token', '图像价格请以模型服务商的计费明细为准'])
    expect(formatUsd(0.00000001)).toBe('$0.00000001')
  })

  it('does not treat absent, invalid, negative, or ambiguous image rates as free per-image prices', () => {
    const prices: Record<string, string>[] = [{}, { image_output: '0.00004' }, { prompt: '-1', completion: 'no-price' }, { image: '0' }]
    for (const pricing of prices) {
      expect(estimateOpenRouterCost({ ...model, pricing }, 4).totalUsd).toBeNull()
    }
  })

  it('multiplies explicit per-output-image cost by requested image count', () => {
    const estimate = estimateOpenRouterCost(model, 3, [endpoint([
      { billable: 'output_image', unit: 'image', costUsd: 0.04 },
      { billable: 'input_image', unit: 'image', costUsd: 0 },
    ])])
    expect(estimate.totalUsd).toBeCloseTo(0.12)
    expect(estimate.label).toContain('$0.12')
    expect(estimate.label).toContain('3 张')
  })

  it('preserves an explicitly free image price', () => {
    expect(estimateOpenRouterCost(model, 2, [endpoint([{ billable: 'output_image', unit: 'image', costUsd: 0 }])]).totalUsd).toBe(0)
  })

  it('labels nonzero input charges separately rather than presenting image subtotal as total', () => {
    const estimate = estimateOpenRouterCost(model, 2, [endpoint([
      { billable: 'output_image', unit: 'image', costUsd: 0.04 },
      { billable: 'input_text', unit: 'token', costUsd: 0.000005 },
    ])])
    expect(estimate.totalUsd).toBeNull()
    expect(estimate.imageSubtotalUsd).toBe(0.08)
    expect(estimate.label).toContain('输入费用')
  })

  it('does not present a lone unresolved resolution tier as an unconditional total', () => {
    const estimate = estimateOpenRouterCost(model, 4, [endpoint([{ billable: 'output_image', unit: 'image', costUsd: 0.08, variant: '4k' }])])
    expect(estimate.totalUsd).toBeNull()
    expect(estimate.label).toContain('条件价')
    expect(estimateOpenRouterCost(model, 1, [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0.00004 }])]).detail).toContain('$40 / 百万 token')
  })

  it('shows a provider range without pretending an exact route is known', () => {
    const estimate = estimateOpenRouterCost(model, 2, [0.04, 0.05].map((costUsd) => endpoint([{ billable: 'output_image', unit: 'image', costUsd }])))
    expect(estimate.totalUsd).toBeNull()
    expect(estimate.label).toContain('$0.08–$0.1')
  })

  it('does not estimate unavailable models or invalid image counts', () => {
    expect(estimateOpenRouterCost({ ...model, supportsImageApi: false }, 1).label).toBe('模型暂不可用')
    for (const n of [0, 1.5, 11, NaN]) expect(estimateOpenRouterCost(model, n).totalUsd).toBeNull()
  })

  it('provides an explicitly heuristic token quote with a non-guaranteed budget range', () => {
    const estimate = estimateOpenRouterCost(model, 2, [endpoint([
      { billable: 'output_image', unit: 'token', costUsd: 0.00004 },
      { billable: 'input_text', unit: 'token', costUsd: 0 },
    ])], { size: '1024x1024', prompt: '' })
    expect(estimate.totalUsd).toBeCloseTo(2000 * 0.00004 * 2)
    expect(estimate.confidence).toBe('heuristic')
    expect(estimate.estimatedUsd).toBe(estimate.totalUsd)
    expect(estimate.shortLabel).toBe('粗估 $0.16')
    expect(estimate.label).toContain('粗估')
    expect(estimate.minUsd).toBeLessThan(estimate.totalUsd!)
    expect(estimate.maxUsd).toBeGreaterThan(estimate.totalUsd!)
    expect(estimate.detail).toContain('2000 token/张')
    expect(estimate.detail).toContain('非官方映射或历史实测')
    expect(estimate.detail).toContain('不是置信区间或费用上限')
  })

  it('anchors known Google model budgets to current documented output tokens by size', () => {
    const google = { ...model, id: 'google/gemini-nano-banana-2.1' }
    const rates = [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0.00003 }, { billable: 'input_text', unit: 'token', costUsd: 0 }])]
    for (const [size, tokens] of [['1K', 1120], ['2K', 1680], ['4K', 2520]] as const) {
      const estimate = estimateOpenRouterCost(google, 1, rates, { size, prompt: '' })
      expect(estimate.totalUsd).toBeCloseTo(tokens * 0.00003)
      expect(estimate.detail).toContain(`${tokens} token/张`)
      expect(estimate.sources?.some((source) => source.url.includes('ai.google.dev'))).toBe(true)
    }
    const wide = estimateOpenRouterCost(google, 1, rates, { size: '2048x512' })
    expect(wide.imageSubtotalUsd).toBeCloseTo(1120 * 0.00003)
    const auto = estimateOpenRouterCost(google, 1, rates, { size: 'auto' })
    expect(auto.detail).toContain('暂按 1K')
    expect(auto.detail).toContain('并非服务商保证的默认尺寸')
    expect(auto.maxUsd).toBeGreaterThanOrEqual(2520 * 0.00003)
  })

  it('uses legacy OpenAI anchors only for their model family and supported quality', () => {
    const gpt = { ...model, id: 'openai/gpt-image-1', supportedParameters: { quality: { type: 'enum' as const, values: ['low', 'medium', 'high'] } } }
    const rates = [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0.00004 }, { billable: 'input_text', unit: 'token', costUsd: 0 }])]
    for (const [quality, tokens] of [['low', 272], ['medium', 1056], ['high', 4160]] as const) {
      const estimate = estimateOpenRouterCost(gpt, 1, rates, { size: '1024x1024', quality })
      expect(estimate.totalUsd).toBeCloseTo(tokens * 0.00004)
      expect(estimate.sources?.some((source) => source.url.includes('developers.openai.com'))).toBe(true)
    }
    const modern = estimateOpenRouterCost({ ...gpt, id: 'openai/gpt-image-2.5-sunburst' }, 1, rates, { size: '1024x1024', quality: 'high' })
    expect(modern.detail).toContain('通用粗估')
    expect(modern.imageSubtotalUsd).not.toBeCloseTo(4160 * 0.00004)
  })

  it('scales output estimates by dimensions, supported quality, and quantity without changing rates', () => {
    const rates = [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0.00004 }, { billable: 'input_text', unit: 'token', costUsd: 0 }])]
    const capable = { ...model, supportedParameters: { quality: { type: 'enum' as const, values: ['low', 'medium', 'high'] } } }
    const base = estimateOpenRouterCost(capable, 1, rates, { size: '1K', quality: 'medium' })
    const larger = estimateOpenRouterCost(capable, 1, rates, { size: '2K', quality: 'medium' })
    const higher = estimateOpenRouterCost(capable, 1, rates, { size: '1K', quality: 'high' })
    const batch = estimateOpenRouterCost(capable, 3, rates, { size: '1K', quality: 'medium' })
    expect(larger.totalUsd).toBeCloseTo(base.totalUsd! * 4)
    expect(higher.totalUsd).toBeGreaterThan(base.totalUsd!)
    expect(batch.totalUsd).toBeCloseTo(base.totalUsd! * 3)
  })

  it('accounts for prompt and reference token costs and single-image request duplication', () => {
    const rates = [endpoint([
      { billable: 'output_image', unit: 'token', costUsd: 0.00004 },
      { billable: 'input_text', unit: 'token', costUsd: 0.000005 },
      { billable: 'input_image', unit: 'token', costUsd: 0.00001 },
    ])]
    const estimate = estimateOpenRouterCost(model, 3, rates, { size: '1K', prompt: 'A bird', referenceImageCount: 2 })
    expect(estimate.totalUsd).toBeCloseTo(3 * (2000 * 0.00004 + 34 * 0.000005 + 2 * 1024 * 0.00001))
    expect(estimate.detail).toContain('预计 3 次请求')
    expect(estimate.detail).toContain('参考图 2 张')
    expect(estimate.detail).toContain('1024 token/张（256–4096）')
    const chinese = estimateOpenRouterCost(model, 1, rates, { prompt: '一只鸟', referenceImageCount: 0 })
    expect(chinese.detail).toContain('提示词约 37 token/次')
  })

  it('estimates batched input once at the point and conservatively repeats it in the upper range', () => {
    const rates = [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0 }, { billable: 'input_text', unit: 'token', costUsd: 1 }])]
    const batched = { ...model, supportedParameters: { n: { type: 'range' as const, min: 1, max: 10 } } }
    const estimate = estimateOpenRouterCost(batched, 4, rates, { prompt: 'A bird' })
    expect(estimate.totalUsd).toBe(34)
    expect(estimate.maxUsd).toBe(34 * 2 * 4)
    expect(estimate.detail).toContain('预计 1 次请求')
  })

  it('does not mix per-image and per-token units when routing providers differ', () => {
    const routes = ['image', 'token'].map((unit) => endpoint([
      { billable: 'output_image', unit, costUsd: unit === 'image' ? 0.04 : 0.00004 },
      { billable: 'input_text', unit: 'token', costUsd: 0 },
    ]))
    const estimate = estimateOpenRouterCost(model, 2, routes, { size: '1K' })
    expect(estimate.totalUsd).toBeCloseTo((0.04 * 2 + 2000 * 0.00004 * 2) / 2)
    expect(estimate.detail).toContain('不代表路由概率')
  })

  it('leaves missing output rates and conditional token rates unknown rather than free', () => {
    for (const prices of [[], [{ billable: 'output_image', unit: 'token', costUsd: 0.00004, variant: '4k' }], [{ billable: 'output_image', unit: 'token', costUsd: NaN }]]) {
      const estimate = estimateOpenRouterCost(model, 2, [endpoint(prices)])
      expect(estimate.totalUsd).toBeNull()
      expect(estimate.confidence).not.toBe('heuristic')
    }
  })

  it('provides known token subtotals while disclosing missing input rates and unsupported billables', () => {
    const estimate = estimateOpenRouterCost(model, 1, [endpoint([
      { billable: 'output_image', unit: 'token', costUsd: 0.00004 },
      { billable: 'input_image', unit: 'megapixel', costUsd: 0.01 },
    ])], { referenceImageCount: 1 })
    expect(estimate.totalUsd).toBeNull()
    expect(estimate.imageSubtotalUsd).toBeGreaterThan(0)
    expect(estimate.label).toContain('未计费用')
    expect(estimate.detail).toContain('输入文本价格未计入')
    expect(estimate.detail).toContain('input_image/megapixel')
  })

  it('only displays zero total when all applicable published token rates explicitly are zero', () => {
    const estimate = estimateOpenRouterCost(model, 2, [endpoint([
      { billable: 'output_image', unit: 'token', costUsd: 0 },
      { billable: 'input_text', unit: 'token', costUsd: 0 },
    ])])
    expect(estimate.totalUsd).toBe(0)
    expect(estimate.minUsd).toBe(0)
    expect(estimate.maxUsd).toBe(0)
  })

  it('rounds heuristic display precision while keeping exact underlying math and listed rates', () => {
    expect(formatEstimatedUsd(0.05123456789)).toBe('$0.0512')
    expect(formatEstimatedUsd(1.23456789)).toBe('$1.23')
    expect(formatUsd(0.000005)).toBe('$0.000005')
    const estimate = estimateOpenRouterCost(model, 1, [endpoint([
      { billable: 'output_image', unit: 'token', costUsd: 0.00003 },
      { billable: 'input_text', unit: 'token', costUsd: 0.000005 },
    ])], { prompt: 'A bird' })
    expect(estimate.estimatedUsd).toBeCloseTo(0.06017)
    expect(estimate.shortLabel).toBe('粗估 $0.0602')
  })

  it('does not count invalid, missing or unknown positive input prices as free', () => {
    for (const input of [
      { billable: 'input_text', unit: 'token', costUsd: -1 },
      { billable: 'input_text', unit: 'token', costUsd: NaN },
      { billable: 'input_text', unit: 'unknown', costUsd: 0.1 },
      { billable: 'input_text', unit: 'token', costUsd: 0.01, variant: 'cached' },
    ]) {
      const estimate = estimateOpenRouterCost(model, 1, [endpoint([{ billable: 'output_image', unit: 'token', costUsd: 0.00004 }, input])])
      expect(estimate.totalUsd).toBeNull()
      expect(estimate.estimatedUsd).toBeGreaterThan(0)
      expect(estimate.shortLabel).toContain('+')
    }
  })

  it('uses verified Muse directory pricing when typed endpoint metadata is empty, and shows its source', () => {
    const muse: OpenRouterImageModel = {
      ...model, id: 'meta/muse-image', pricing: { prompt: '0', completion: '0', image_output: '0.00000239520958083832' },
      displayPricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.01 }],
      displayPricingSource: { label: 'OpenRouter 目录显示价格', url: 'https://openrouter.ai/api/frontend/v1/models/find?order=newest' },
    }
    expect(describeOpenRouterPricing(muse)).toEqual(['输出图像 $0.01 / 张'])
    const estimate = estimateOpenRouterCost(muse, 3, [])
    expect(estimate.totalUsd).toBeCloseTo(0.03)
    expect(estimate.confidence).toBe('catalog')
    expect(estimate.detail).toContain('目录当前展示服务商')
    expect(estimate.detail).toContain('实际路由价格可能不同')
    expect(estimate.detail).toContain('可选工具与未列明附加条件费用未计入')
    expect(estimate.sources).toEqual([muse.displayPricingSource])
  })

  it('prefers typed output prices and never silently discards unpriced provider routes', () => {
    const fallback = { ...model, displayPricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.01 }] }
    expect(estimateOpenRouterCost(fallback, 2, [endpoint([{ billable: 'output_image', unit: 'image', costUsd: 0.04 }])]).totalUsd).toBe(0.08)
    const partial = estimateOpenRouterCost(fallback, 2, [endpoint([{ billable: 'output_image', unit: 'image', costUsd: 0.04 }]), endpoint([])])
    expect(partial.totalUsd).toBeNull()
    expect(partial.detail).not.toContain('目录当前展示服务商')
  })

  it('suppresses meaningless zero text price fallback lines', () => {
    expect(describeOpenRouterPricing({ ...model, pricing: { prompt: '0', completion: '0' } })).toEqual(['暂无已确认计费单位的价格'])
  })

  it('matches explicit resolution tiers, preserving the full published range for automatic size', () => {
    const tiers = [['768', 0.041], ['1K', 0.048], ['1.5K', 0.07], ['2K', 0.1], ['4K', 0.607]] as const
    const flux = { ...model, displayPricing: tiers.map(([variant, costUsd]) => ({ billable: 'output_image', unit: 'image', costUsd, variant })) }
    expect(estimateOpenRouterCost(flux, 2, [], { size: '2K' }).totalUsd).toBeCloseTo(0.2)
    expect(estimateOpenRouterCost(flux, 2, [], { size: '2048x2048' }).totalUsd).toBeCloseTo(0.2)
    const auto = estimateOpenRouterCost(flux, 2, [], { size: 'auto' })
    expect(auto.totalUsd).toBeNull()
    expect(auto.minUsd).toBeCloseTo(0.082)
    expect(auto.maxUsd).toBeCloseTo(1.214)
    expect(auto.detail).toContain('档位/条件尚未完全确定')
  })

  it('matches combined quality/resolution and px tiers without charging all alternatives together', () => {
    const grok = { ...model, displayPricing: [['low/1K', 0.04], ['low/2K', 0.06], ['medium/1K', 0.06], ['medium/2K', 0.08]].map(([variant, costUsd]) => ({ billable: 'output_image', unit: 'image', costUsd: Number(costUsd), variant: String(variant) })) }
    expect(estimateOpenRouterCost(grok, 1, [], { size: '2K', quality: 'medium' }).totalUsd).toBeCloseTo(0.08)
    const unknownQuality = estimateOpenRouterCost(grok, 1, [], { size: '2K', quality: 'auto' })
    expect(unknownQuality.minUsd).toBeCloseTo(0.06)
    expect(unknownQuality.maxUsd).toBeCloseTo(0.08)
    const sourceful = { ...model, displayPricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.13, variant: '1024px' }, { billable: 'output_image', unit: 'image', costUsd: 0.15, variant: '2048px' }] }
    expect(estimateOpenRouterCost(sourceful, 1, [], { size: '2048x2048' }).totalUsd).toBeCloseTo(0.15)
    const singleQuality = { ...model, displayPricing: [{ billable: 'output_image', unit: 'image', costUsd: 0.04, variant: 'low/1K' }] }
    expect(estimateOpenRouterCost(singleQuality, 1, [], { size: '1K', quality: 'auto' }).totalUsd).toBeNull()
    expect(estimateOpenRouterCost(singleQuality, 1, [], { size: '1K', quality: 'low' }).totalUsd).toBeCloseTo(0.04)
  })

  it('keeps unknown high-resolution and style conditions as alternatives rather than additive charges', () => {
    const seed = { ...model, displayPricing: [
      { billable: 'output_image', unit: 'image', costUsd: 0.045 },
      { billable: 'output_image', unit: 'image', costUsd: 0.09, variant: 'High-Resolution Image Output' },
    ] }
    const estimate = estimateOpenRouterCost(seed, 1, [], { size: '2K' })
    expect(estimate.totalUsd).toBeNull()
    expect(estimate.minUsd).toBeCloseTo(0.045)
    expect(estimate.maxUsd).toBeCloseTo(0.09)
  })

  it('estimates explicit megapixel output while disclosing rounding and unknown reference pixels', () => {
    const flex = { ...model, displayPricing: [
      { billable: 'output_image', unit: 'megapixel', costUsd: 0.06 },
      { billable: 'input_image', unit: 'megapixel', costUsd: 0.06 },
    ] }
    const estimate = estimateOpenRouterCost(flex, 2, [], { size: '1024x1024', referenceImageCount: 0 })
    expect(estimate.estimatedUsd).toBeCloseTo(2 * 1024 * 1024 / 1000000 * 0.06)
    expect(estimate.confidence).toBe('heuristic')
    expect(estimate.detail).toContain('像素数/1,000,000')
    expect(estimate.detail).toContain('最小计费单位未确认')
    const edits = estimateOpenRouterCost(flex, 1, [], { size: '1K', referenceImageCount: 1 })
    expect(edits.totalUsd).toBeNull()
    expect(edits.label).toContain('未计费用')
    expect(estimateOpenRouterCost(flex, 1, [], { size: 'auto' }).detail).toContain('暂按 1024×1024')
    const missingReferenceRate = estimateOpenRouterCost(model, 1, [endpoint([{ billable: 'output_image', unit: 'megapixel', costUsd: 0.06 }])], { referenceImageCount: 1 })
    expect(missingReferenceRate.totalUsd).toBeNull()
    expect(missingReferenceRate.detail).toContain('未公布的参考图价格未计入')
  })

  it('bills an explicit generation request price per actual request, not per image or optional tool', () => {
    const batch = { ...model, supportedParameters: { n: { type: 'range' as const, min: 1, max: 4 } } }
    const prices = [endpoint([{ billable: 'output_image', unit: 'request', costUsd: 0.1 }])]
    expect(estimateOpenRouterCost(batch, 3, prices).totalUsd).toBeCloseTo(0.1)
    expect(estimateOpenRouterCost(batch, 5, prices).totalUsd).toBeCloseTo(0.2)
    expect(estimateOpenRouterCost(model, 3, prices).totalUsd).toBeCloseTo(0.3)
    const ancillary = estimateOpenRouterCost(batch, 3, [endpoint([{ billable: 'style_creation', unit: 'request', costUsd: 1 }])])
    expect(ancillary.totalUsd).toBeNull()
  })

  it('hides zero non-image billables from details but preserves explicit free output prices', () => {
    const estimate = estimateOpenRouterCost(model, 1, [endpoint([
      { billable: 'output_image', unit: 'image', costUsd: 0 },
      { billable: 'input_text', unit: 'token', costUsd: 0 },
      { billable: 'output_text', unit: 'token', costUsd: 0 },
    ])])
    expect(estimate.detail).toContain('输出图像 $0 / 张')
    expect(estimate.detail).not.toContain('输入文本 $0')
    expect(estimate.detail).not.toContain('输出文本 $0')
    expect(estimate.totalUsd).toBe(0)
  })
})
