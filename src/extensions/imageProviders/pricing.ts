import type { OpenRouterImageEndpoint, OpenRouterImageModel, OpenRouterImagePrice } from './types'
import { getImageTokenBudget, type OpenRouterCostAssumptions } from './imageTokenBudget'

export type { OpenRouterCostAssumptions } from './imageTokenBudget'

export interface OpenRouterCostEstimate {
  totalUsd: number | null
  estimatedUsd?: number
  label: string
  shortLabel?: string
  detail: string
  imageSubtotalUsd?: number
  minUsd?: number
  maxUsd?: number
  confidence?: 'heuristic' | 'catalog'
  sources?: Array<{ label: string; url: string }>
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 12,
  }).format(value)
}

export function formatEstimatedUsd(value: number): string {
  return formatUsd(Number(value.toPrecision(3)))
}

export function describeOpenRouterPricing(model: OpenRouterImageModel): string[] {
  if (model.displayPricing?.length) {
    return model.displayPricing.filter((price) => price.costUsd > 0 || price.billable === 'output_image').map(describePrice)
  }
  const lines: string[] = []
  for (const [key, label] of [['prompt', '输入文本'], ['completion', '输出文本']] as const) {
    const raw = model.pricing[key]
    const value = raw?.trim() ? Number(raw) : NaN
    if (Number.isFinite(value) && value > 0) lines.push(`${label} ${formatUsd(value * 1000000)} / 百万 token`)
  }
  // 通用目录的 image_output 历来存在单位歧义，不能直接乘图片数。
  if (model.pricing.image_output !== undefined || model.pricing.image !== undefined) {
    lines.push('图像价格请以模型服务商的计费明细为准')
  }
  return lines.length ? lines : ['暂无已确认计费单位的价格']
}

function describePrice(price: OpenRouterImagePrice): string {
  const billables: Record<string, string> = {
    output_image: '输出图像', input_image: '参考图像', input_text: '输入文本',
    input_reference: '输入参考', output_text: '输出文本',
  }
  const units: Record<string, string> = { image: '张', megapixel: '百万像素', token: '百万 token', request: '次请求' }
  return `${billables[price.billable] ?? price.billable}${price.variant ? `（${price.variant}）` : ''} ${formatUsd(price.costUsd * (price.unit === 'token' ? 1000000 : 1))} / ${units[price.unit] ?? price.unit}`
}

function priceResolution(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/px$/, '')
  const tiers: Record<string, number> = { '512': 512, '768': 768, '1k': 1024, '1.5k': 1536, '2k': 2048, '4k': 4096, '1024': 1024, '1536': 1536, '2048': 2048, '4096': 4096 }
  return tiers[normalized]
}

export function estimateOpenRouterCost(
  model: OpenRouterImageModel | undefined,
  n: number,
  endpoints?: OpenRouterImageEndpoint[],
  assumptions: OpenRouterCostAssumptions = {},
): OpenRouterCostEstimate {
  if (!model) return { totalUsd: null, label: '费用待确认', detail: '请先加载模型目录并选择模型' }
  if (!model.supportsImageApi) return { totalUsd: null, label: '模型暂不可用', detail: '该模型目前未列入 OpenRouter 图像 API 可用目录' }
  if (!Number.isInteger(n) || n < 1 || n > 10) return { totalUsd: null, label: '费用待确认', detail: '图片数量应为 1–10 张' }
  const hasOutputPrice = (prices: OpenRouterImagePrice[]) => prices.some((price) => price.billable === 'output_image' && Number.isFinite(price.costUsd) && price.costUsd >= 0)
  const catalogFallback = !endpoints?.some((endpoint) => hasOutputPrice(endpoint.pricing)) && model.displayPricing && hasOutputPrice(model.displayPricing)
  if (catalogFallback) {
    endpoints = [{ providerName: 'OpenRouter', providerSlug: 'catalog', pricing: model.displayPricing!, supportedParameters: model.supportedParameters ?? {} }]
  }
  const rateSources = catalogFallback && model.displayPricingSource ? [model.displayPricingSource] : endpoints?.length ? [{
    label: 'OpenRouter 图像 API 价格',
    url: `https://openrouter.ai/api/v1/images/models/${model.id.split('/').map(encodeURIComponent).join('/')}/endpoints`,
  }] : []
  const sourceNote = catalogFallback ? '图像 API 定价明细缺失，使用 OpenRouter 目录当前展示服务商带明确计费单位的价格；实际路由价格可能不同；可选工具与未列明附加条件费用未计入；' : ''
  if (!endpoints?.length) {
    return { totalUsd: null, label: '费用待确认', detail: `请求 ${n} 张；${describeOpenRouterPricing(model).join('；')}。图像输出总价需要服务商明细，最终以 OpenRouter 账单为准` }
  }
  const descriptions = [...new Set(endpoints.flatMap((endpoint) => endpoint.pricing
    .filter((price) => price.costUsd !== 0 || price.billable === 'output_image').map(describePrice)))]
  const size = assumptions.size?.trim().toLowerCase() ?? 'auto'
  const pixels = size.match(/^(\d+)x(\d+)$/)
  const resolution = priceResolution(size) ?? (pixels && pixels[1] === pixels[2] ? priceResolution(pixels[1]) : undefined)
  const rawRates = endpoints.map((endpoint) => endpoint.pricing.filter((price) => price.billable === 'output_image'))
  const rates = rawRates.map((prices) => {
    if (!prices.length || prices.some((price) => !price.variant)) return prices
    const variants = prices.map((price) => {
      const parts = price.variant!.toLowerCase().split('/')
      const quality = parts.length === 2 && ['low', 'medium', 'high', 'xhigh', 'max'].includes(parts[0]) ? parts[0] : undefined
      const resolution = parts.length === 1 || quality ? priceResolution(parts[parts.length - 1]) : undefined
      return { quality, resolution }
    })
    if (!resolution || variants.some((variant) => !variant.resolution)) return prices
    const matches = prices.filter((_, index) => variants[index].resolution === resolution
      && (!variants[index].quality || !assumptions.quality || assumptions.quality === 'auto' || variants[index].quality === assumptions.quality))
    // 没有可靠匹配时保留全部档位作为可能范围，不拿最低档冒充当前价格。
    const matchedQuality = matches.length === 1 ? variants[prices.indexOf(matches[0])].quality : undefined
    return matches.length === 1 && (!matchedQuality || matchedQuality === assumptions.quality)
      ? [{ ...matches[0], variant: undefined }] : matches.length ? matches : prices
  })
  const variantNote = rawRates.some((prices) => prices.some((price) => price.variant))
    ? rates.every((prices) => prices.length === 1 && !prices[0].variant)
      ? `按所选尺寸${size === 'auto' ? '' : ` ${size}`}与画质匹配已公布档位；`
      : '档位/条件尚未完全确定，展示已公布备选价格范围；'
    : ''
  const fixed = rates.every((prices) => prices.length === 1 && prices[0].unit === 'image' && !prices[0].variant && Number.isFinite(prices[0].costUsd) && prices[0].costUsd >= 0)
  const tokenPriced = rates.some((prices) => prices.some((price) => price.unit === 'token'))
  const estimable = rates.every((prices) => prices.length === 1 && !prices[0].variant
    && ['image', 'token'].includes(prices[0].unit) && Number.isFinite(prices[0].costUsd) && prices[0].costUsd >= 0)
  if (tokenPriced && estimable) {
    const budget = getImageTokenBudget(model, assumptions)
    const ascii = assumptions.prompt?.match(/[\x00-\x7f]/g)?.length ?? 0
    const other = assumptions.prompt ? Array.from(assumptions.prompt).length - ascii : 0
    const promptTokens = assumptions.prompt === undefined ? 132 : Math.ceil(ascii / 4 + other * 1.5) + 32
    const references = Number.isFinite(assumptions.referenceImageCount) ? Math.max(0, Math.floor(assumptions.referenceImageCount!)) : 0
    const maxPerRequest = model.supportedParameters?.n?.type === 'range' ? Math.min(10, Math.max(1, Math.floor(model.supportedParameters.n.max))) : 1
    const requests = Math.ceil(n / maxPerRequest)
    const exclusions = new Set<string>()
    const estimated = endpoints.map((endpoint, index) => {
      const output = rates[index][0]
      const multiplier = output.unit === 'token' ? budget.tokens : 1
      let point = output.costUsd * multiplier * n
      let min = output.costUsd * (output.unit === 'token' ? budget.minTokens : 1) * n
      let max = output.costUsd * (output.unit === 'token' ? budget.maxTokens : 1) * n
      const imageSubtotal = point
      if (!endpoint.pricing.some((price) => price.billable === 'input_text')) exclusions.add('未公布的输入文本价格未计入')
      if (references > 0 && !endpoint.pricing.some((price) => ['input_image', 'input_reference'].includes(price.billable))) exclusions.add('未公布的参考图价格未计入')
      for (const price of endpoint.pricing) {
        if (price.billable === 'output_image' || price.costUsd === 0) continue
        let units: [number, number, number] | undefined
        if (!price.variant && Number.isFinite(price.costUsd) && price.costUsd > 0) {
          if (price.billable === 'input_text' && price.unit === 'token') units = [promptTokens, Math.floor(promptTokens * 0.5), promptTokens * 2]
          if (['input_image', 'input_reference'].includes(price.billable)) {
            if (price.unit === 'token') units = [references * 1024, references * 256, references * 4096]
            if (price.unit === 'image') units = [references, references, references]
          }
          if (price.billable === 'output_text' && price.unit === 'token') units = [256, 0, 1024]
        }
        if (!units) {
          exclusions.add(`未确定的 ${price.billable}/${price.unit}${price.variant ? `/${price.variant}` : ''} 费用未计入`)
          continue
        }
        point += price.costUsd * units[0] * requests
        min += price.costUsd * units[1] * requests
        // 上界保守按每张图一次请求计入重复输入，不假设所有路由都能合并。
        max += price.costUsd * units[2] * n
      }
      return { point, min, max, imageSubtotal }
    })
    const complete = exclusions.size === 0
    const min = Math.min(...estimated.map((cost) => cost.min))
    const max = Math.max(...estimated.map((cost) => cost.max))
    const point = estimated.reduce((sum, cost) => sum + cost.point, 0) / estimated.length
    const imageSubtotal = estimated.reduce((sum, cost) => sum + cost.imageSubtotal, 0) / estimated.length
    const hasTextOutput = endpoints.some((endpoint) => endpoint.pricing.some((price) => price.billable === 'output_text' && price.costUsd > 0))
    const sources = [...rateSources, ...(budget.source ? [budget.source] : [])]
    return {
      totalUsd: complete ? point : null,
      estimatedUsd: point,
      imageSubtotalUsd: imageSubtotal,
      minUsd: min,
      maxUsd: max,
      confidence: 'heuristic',
      sources,
      shortLabel: `粗估 ${formatEstimatedUsd(point)}${complete ? '' : '+'}`,
      label: `粗估 ${formatEstimatedUsd(point)} / ${n} 张（${formatEstimatedUsd(min)}–${formatEstimatedUsd(max)}）${complete ? '' : ' + 未计费用'}`,
      detail: `${sourceNote}${variantNote}${budget.description}；输出图像按 ${budget.tokens} token/张预算（${budget.minTokens}–${budget.maxTokens}），共 ${n} 张。提示词约 ${promptTokens} token/次（ASCII 约 4 字符/token，其他字符约 1.5 token/字，另留 32 token 余量；未提供提示词时假定 100+32 token）。参考图 ${references} 张，若按 token 计费则暂按 1024 token/张（256–4096），不是实际图像编码计数。预计 ${requests} 次请求；输入费用上界按 ${n} 次重复计入${hasTextOutput ? '；附带文本/推理暂留 256 token/次（0–1024）' : '；未单列的附带文本/推理费用未计入'}。${endpoints.length > 1 ? '参考值取可用服务商估值的算术均值，不代表路由概率；' : ''}${[...exclusions].join('；')}${exclusions.size ? '；以上仅为已知项目小计。' : ''}费率来自 OpenRouter 明细：${descriptions.join('；')}。区间是粗略预算余量，不是置信区间或费用上限；实际尺寸、画质、token 与服务商可能不同，最终以账单为准（USD）`,
    }
  }
  const knownUnits = rates.every((prices) => prices.length > 0
    && (prices.length === 1 || prices.filter((price) => !price.variant).length <= 1)
    && prices.every((price) => ['image', 'megapixel', 'request'].includes(price.unit) && Number.isFinite(price.costUsd) && price.costUsd >= 0))
  if (!fixed && knownUnits) {
    const hasMegapixels = rates.some((prices) => prices.some((price) => price.unit === 'megapixel'))
    const width = pixels ? Number(pixels[1]) : priceResolution(size) ?? 1024
    const height = pixels ? Number(pixels[2]) : priceResolution(size) ?? 1024
    const specifiedSize = (pixels || priceResolution(size)) && width > 0 && height > 0 && Number.isFinite(width * height)
    const megapixels = specifiedSize ? width * height / 1000000 : 1024 * 1024 / 1000000
    const minMegapixels = specifiedSize ? Math.min(megapixels, Math.max(1, Math.floor(megapixels))) : 1
    const maxMegapixels = specifiedSize ? Math.max(1, Math.ceil(megapixels)) : 17
    const maxPerRequest = model.supportedParameters?.n?.type === 'range' ? Math.min(10, Math.max(1, Math.floor(model.supportedParameters.n.max))) : 1
    const requests = Math.ceil(n / maxPerRequest)
    const references = Math.max(0, Number.isFinite(assumptions.referenceImageCount) ? Math.floor(assumptions.referenceImageCount!) : 0)
    const exclusions = new Set<string>()
    const possibilities = rates.flatMap((prices, index) => {
      let inputs = 0
      if (references > 0 && !endpoints![index].pricing.some((price) => ['input_image', 'input_reference'].includes(price.billable))) {
        exclusions.add('未公布的参考图价格未计入')
      }
      for (const price of endpoints![index].pricing) {
        if (price.billable === 'output_image' || price.costUsd === 0) continue
        const reference = ['input_image', 'input_reference'].includes(price.billable)
        if (reference && references === 0) continue
        if (reference && price.unit === 'image' && !price.variant && Number.isFinite(price.costUsd) && price.costUsd > 0) {
          inputs += price.costUsd * references * requests
        } else {
          exclusions.add(`${describePrice(price)} 未计入（用量或适用条件待确认）`)
        }
      }
      return prices.map((price) => {
        const count = price.unit === 'request' ? requests : n
        return {
          point: price.costUsd * count * (price.unit === 'megapixel' ? megapixels : 1) + inputs,
          min: price.costUsd * count * (price.unit === 'megapixel' ? minMegapixels : 1) + inputs,
          max: price.costUsd * count * (price.unit === 'megapixel' ? maxMegapixels : 1) + inputs,
        }
      })
    })
    const min = Math.min(...possibilities.map((price) => price.min))
    const max = Math.max(...possibilities.map((price) => price.max))
    const point = possibilities.reduce((sum, price) => sum + price.point, 0) / possibilities.length
    const amount = min === max ? formatUsd(min) : `${formatEstimatedUsd(min)}–${formatEstimatedUsd(max)}`
    const extra = exclusions.size > 0
    const unresolvedVariant = rates.some((prices) => prices.some((price) => price.variant))
    const label = hasMegapixels ? `粗估 ${formatEstimatedUsd(point)}` : `${unresolvedVariant && min === max ? '条件价' : '约'} ${amount}`
    return {
      totalUsd: !extra && !unresolvedVariant && (hasMegapixels || min === max) ? point : null,
      estimatedUsd: point,
      minUsd: min,
      maxUsd: max,
      confidence: hasMegapixels ? 'heuristic' : 'catalog',
      sources: rateSources,
      shortLabel: `${label}${extra ? '+' : ''}`,
      label: `${label} / ${n} 张${hasMegapixels ? `（${amount}）` : ''}${extra ? ' + 未计费用' : ''}`,
      detail: `${sourceNote}${variantNote}${hasMegapixels ? `${specifiedSize ? `按请求尺寸 ${width}×${height}` : '自动尺寸暂按 1024×1024，区间覆盖约 1K–4K 正方形'}、像素数/1,000,000 估算为 ${Number(megapixels.toPrecision(3))} 百万像素/张；档位尺寸按正方形预算。区间计入邻近整百万像素取整假设；服务商实际尺寸、取整和最小计费单位未确认，不是费用上限。` : ''}请求 ${n} 张，预计 ${requests} 次 API 调用；每张与每次请求分别按公布单位计费。参考图 ${references} 张，已计入已知按张输入价格；参考图像素/token 与其他条件费用未假定为免费。${[...exclusions].join('；')}${extra ? '；以上仅为已知项目小计。' : ''}${descriptions.join('；')}。实际路由或适用档位可能不同，最终以 OpenRouter 账单为准（USD）`,
    }
  }
  if (!fixed) {
    return {
      totalUsd: null,
      label: '按用量计费',
      sources: rateSources,
      detail: `${sourceNote}请求 ${n} 张；${descriptions.join('；') || '服务商暂无价格'}。token 用量、像素计费取整或档位尚未确定，无法可靠换算总价，最终以 OpenRouter 账单为准`,
    }
  }
  const min = Math.min(...rates.map((prices) => prices[0].costUsd)) * n
  const max = Math.max(...rates.map((prices) => prices[0].costUsd)) * n
  const extra = endpoints.some((endpoint) => endpoint.pricing.some((price) => price.billable !== 'output_image' && price.costUsd > 0))
  const amount = min === max ? formatUsd(min) : `${formatUsd(min)}–${formatUsd(max)}`
  return {
    totalUsd: !extra && min === max ? min : null,
    confidence: 'catalog',
    sources: rateSources,
    ...(min === max ? { imageSubtotalUsd: min } : {}),
    label: `约 ${amount}${extra ? ' + 输入费用' : ''} / ${n} 张`,
    detail: `${sourceNote}${variantNote}${extra ? '仅输出图像小计，输入费用另计' : '按已发布的每张图像价格估算'}；${min !== max ? '实际路由服务商会影响价格；' : ''}${descriptions.join('；')}。USD，最终以 OpenRouter 账单为准`,
  }
}
