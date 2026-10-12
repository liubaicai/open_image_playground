import type { OpenRouterImageModel } from './types'

export interface OpenRouterCostAssumptions {
  size?: string
  quality?: string
  prompt?: string
  referenceImageCount?: number
}

export interface ImageTokenBudget {
  tokens: number
  minTokens: number
  maxTokens: number
  description: string
  source?: { label: string; url: string }
}

export function getImageTokenBudget(model: OpenRouterImageModel, assumptions: OpenRouterCostAssumptions): ImageTokenBudget {
  const size = assumptions.size?.trim().toUpperCase() ?? 'AUTO'
  const pixels = size.match(/^(\d+)X(\d+)$/)
  const tiers: Record<string, number> = { '512': 512, '768': 768, '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 }
  const width = pixels ? Number(pixels[1]) : tiers[size] ?? 1024
  const height = pixels ? Number(pixels[2]) : tiers[size] ?? 1024
  const knownSize = Boolean(tiers[size] || pixels) && width > 0 && height > 0 && Number.isFinite(width * height)
  const area = knownSize ? width * height / (1024 * 1024) : 1
  const edge = Math.sqrt(area) * 1024
  const tier = edge <= 724 ? '512' : edge <= 1448 ? '1K' : edge <= 2896 ? '2K' : '4K'
  const sizeNote = knownSize ? `尺寸 ${assumptions.size}` : '自动/未知尺寸暂按 1K 估算，并非服务商保证的默认尺寸'
  const qualityDescriptor = model.supportedParameters?.quality
  const quality = qualityDescriptor?.type === 'enum' && qualityDescriptor.values.includes(assumptions.quality ?? '') ? assumptions.quality! : 'auto'
  const id = model.id.split(':')[0]

  // 官方表只作为特定模型的 token 基准；区间是预算余量，不是官方上下限或实测误差。
  // 核验日期：2026-10-12。费率始终从实时 OpenRouter endpoint pricing 读取。
  if (/^google\/gemini-(nano-banana-2\.1|3\.1-flash-image|3-pro-image|2\.5-flash-image)(-preview)?$/.test(id)) {
    const flash25 = id.includes('2.5-flash-image')
    const pro = id.includes('3-pro-image')
    const counts = pro ? { '512': 1120, '1K': 1120, '2K': 1120, '4K': 2000 }
      : { '512': id.includes('3.1-flash-image') ? 747 : 1120, '1K': 1120, '2K': 1680, '4K': 2520 }
    const tokens = flash25 ? 1290 : counts[tier]
    return {
      tokens,
      minTokens: Math.floor(tokens * 0.75),
      maxTokens: Math.ceil(Math.max(tokens * 1.5, !knownSize && !flash25 ? counts['4K'] : 0)),
      description: `${sizeNote}；参考 Google 图像 token 表${flash25 ? '' : `的 ${tier} 档位`}；显式像素到档位按面积近似，实际归一化可能不同`,
      source: { label: 'Google 图像 token 参考', url: 'https://ai.google.dev/gemini-api/docs/image-generation' },
    }
  }

  if (id === 'openai/gpt-image-1' || id === 'openai/gpt-image-1.5') {
    const table = width === 1024 && height === 1536 ? { low: 408, medium: 1584, high: 6240 }
      : width === 1536 && height === 1024 ? { low: 400, medium: 1568, high: 6208 }
      : { low: Math.ceil(272 * area), medium: Math.ceil(1056 * area), high: Math.ceil(4160 * area) }
    const selected = quality === 'low' || quality === 'medium' || quality === 'high' ? quality : 'medium'
    const tokens = table[selected]
    return {
      tokens,
      minTokens: Math.floor((quality === 'auto' ? table.low : tokens) * 0.75),
      maxTokens: Math.ceil((quality === 'auto' ? table.high : tokens) * 1.5),
      description: `${sizeNote}；参考早期 GPT Image token 表，${quality === 'auto' ? '自动画质按 medium 作参考，区间覆盖 low–high' : `画质 ${selected}`}；非表格尺寸按面积近似`,
      source: { label: 'OpenAI 图像 token 参考', url: 'https://developers.openai.com/api/docs/guides/image-generation' },
    }
  }

  const budgets: Record<string, number> = { low: 500, medium: 2000, high: 8000, xhigh: 12000, max: 16000, auto: 2000 }
  const tokens = Math.ceil((budgets[quality] ?? budgets.auto) * area)
  return {
    tokens,
    minTokens: Math.max(1, Math.floor(tokens * (quality === 'auto' ? 0.25 : 0.5))),
    maxTokens: Math.ceil(tokens * (quality === 'auto' || !knownSize ? 4 : 2)),
    description: `${sizeNote}；无该模型可靠 token 表，采用通用粗估：1K、medium/自动先按 2000 图像 token/张，按面积与受支持画质缩放（当前按 ${quality}）；这是预算假设，非官方映射或历史实测`,
  }
}
