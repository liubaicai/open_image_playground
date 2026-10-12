export interface PromptOptimizationConfig {
  enabled: boolean
  profileId: string
  model: string
  allowUnknownModel: boolean
}

export type PromptOptimizationCapability = 'verified' | 'unknown' | 'unsupported'

export interface PromptOptimizationModel {
  id: string
  name: string
  inputModalities: string[]
  outputModalities: string[]
  capability: PromptOptimizationCapability
}
