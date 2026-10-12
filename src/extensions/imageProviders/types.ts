export type OpenRouterParameter =
  | { type: 'enum'; values: string[] }
  | { type: 'range'; min: number; max: number }
  | { type: 'boolean' }

export interface OpenRouterImageModel {
  id: string
  name: string
  inputModalities: string[]
  outputModalities: string[]
  pricing: Record<string, string>
  displayPricing?: OpenRouterImagePrice[]
  displayPricingSource?: { label: string; url: string }
  description?: string
  contextLength?: number
  supportedParameters?: Record<string, OpenRouterParameter>
  supportsImageApi: boolean
  source: 'frontend' | 'public'
}

export type OpenRouterModel = OpenRouterImageModel

export interface OpenRouterImagePrice {
  billable: string
  unit: string
  costUsd: number
  variant?: string
}

export interface OpenRouterImageEndpoint {
  providerName: string
  providerSlug: string
  providerTag?: string
  pricing: OpenRouterImagePrice[]
  supportedParameters: Record<string, OpenRouterParameter>
}
