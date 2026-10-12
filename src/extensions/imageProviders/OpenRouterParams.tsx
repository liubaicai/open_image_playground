import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ApiProfile, AppSettings, BatchProgress, TaskParams } from '../../types'
import Select from '../../components/Select'
import ParamPopoverChip, { CHIP_BASE_CLASS, CHIP_IDLE_CLASS } from '../../components/input/paramPopoverChip'
import { DEFAULT_BATCH_PROMPT_CONCURRENCY, normalizeBatchPromptConcurrency } from '../../lib/batchPrompts'
import { readCachedOpenRouterImageModels, subscribeOpenRouterImageModels } from './catalog'
import ModelCost from './ModelCost'

const CHIP_CLASS = `${CHIP_BASE_CLASS} ${CHIP_IDLE_CLASS}`

function getEnumValues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'enum' || !('values' in value) || !Array.isArray(value.values)) return []
  return value.values.filter((item): item is string => typeof item === 'string')
}

export default function OpenRouterParams({
  profile, modelOptions, onModelChange, modelSelector, prompt, referenceImageCount, params, setParams, onOpenSizePicker, agentAutoImageCount,
  showBatch, settings, setSettings, batchPromptCount, batchProgress, onStopBatch,
}: {
  profile: ApiProfile
  modelOptions: Array<{ label: string; value: string }>
  onModelChange: (model: string) => void
  modelSelector?: ReactNode
  prompt?: string
  referenceImageCount?: number
  params: TaskParams
  setParams: (patch: Partial<TaskParams>) => void
  onOpenSizePicker: () => void
  agentAutoImageCount: boolean
  showBatch: boolean
  settings: AppSettings
  setSettings: (patch: Partial<AppSettings>) => void
  batchPromptCount: number
  batchProgress: BatchProgress | null
  onStopBatch: () => void
}) {
  const catalog = useSyncExternalStore(subscribeOpenRouterImageModels, readCachedOpenRouterImageModels, readCachedOpenRouterImageModels)
  const model = catalog.find((item) => item.id === profile.model)
  const qualityValues = getEnumValues(model?.supportedParameters?.quality).filter((value) => ['low', 'medium', 'high', 'xhigh', 'max'].includes(value))
  const formatValues = getEnumValues(model?.supportedParameters?.output_format).filter((value) => ['png', 'jpeg', 'webp'].includes(value))
  useEffect(() => {
    if (!model) return
    const patch: Partial<TaskParams> = {}
    if (params.quality !== 'auto' && !qualityValues.includes(params.quality)) patch.quality = 'auto'
    if (formatValues.length > 0 && !formatValues.includes(params.output_format)) patch.output_format = formatValues[0] as TaskParams['output_format']
    if (Object.keys(patch).length) setParams(patch)
  }, [model, params.quality, params.output_format, setParams])
  const [count, setCount] = useState(String(params.n))
  useEffect(() => setCount(String(params.n)), [params.n])

  const commitCount = () => {
    const number = Number(count)
    const next = Math.min(10, Math.max(1, Number.isFinite(number) ? Math.trunc(number) : params.n))
    setCount(String(next))
    setParams({ n: next })
  }
  const prefix = (label: string) => <span className="mr-1.5 text-gray-400 dark:text-gray-500">{label}</span>

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center sm:flex-nowrap gap-2 text-xs">
      <div className="min-w-0 max-w-full flex-1 sm:flex-initial">
        {modelSelector ?? <Select value={profile.model} options={modelOptions.length ? modelOptions : [{ label: '请先启用模型', value: '' }]} disabled={!modelOptions.length} onChange={(value) => onModelChange(String(value))} showValueTooltips menuClassName="min-w-max" className={CHIP_CLASS} />}
      </div>
      <button type="button" onClick={onOpenSizePicker} className={`${CHIP_CLASS} shrink-0`} title="OpenRouter 会将尺寸换算为模型支持的分辨率和宽高比">
        {prefix('尺寸')}<span className="font-mono">{params.size === 'auto' ? '默认' : params.size}</span>
      </button>
      {qualityValues.length > 0 && (
        <Select value={qualityValues.includes(params.quality) ? params.quality : 'auto'} onChange={(value) => setParams({ quality: value as TaskParams['quality'] })} options={[{ label: '默认', value: 'auto' }, ...qualityValues.map((value) => ({ label: value, value }))]} prefix={prefix('质量')} className={CHIP_CLASS} />
      )}
      {formatValues.length > 0 && (
        <Select value={formatValues.includes(params.output_format) ? params.output_format : formatValues[0]} onChange={(value) => setParams({ output_format: value as TaskParams['output_format'] })} options={formatValues.map((value) => ({ label: value.toUpperCase(), value }))} prefix={prefix('格式')} className={CHIP_CLASS} />
      )}
      <label className={`flex shrink-0 items-center ${CHIP_CLASS}`} title={agentAutoImageCount ? 'Agent 模式下数量由模型自动决定' : '最多 10 张；单图模型会拆分为多次请求，按实际请求计费'}>
        {prefix('数量')}
        <input aria-label="生成数量" value={agentAutoImageCount ? 'auto' : count} onChange={(event) => setCount(event.target.value)} onBlur={commitCount} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} disabled={agentAutoImageCount} type={agentAutoImageCount ? 'text' : 'number'} min={1} max={10} step={1} className="w-8 bg-transparent text-xs outline-none disabled:cursor-not-allowed" />
      </label>
      <ModelCost profile={profile} n={params.n} size={params.size} quality={params.quality} prompt={prompt} referenceImageCount={referenceImageCount} />
      {showBatch && (
        <ParamPopoverChip label="批量" summary={batchProgress ? `${batchProgress.finished}/${batchProgress.total}` : settings.batchPromptEnabled ? `${batchPromptCount} 条` : undefined} active={settings.batchPromptEnabled || Boolean(batchProgress)}>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>多提示词批量提交</span>
            <input type="checkbox" checked={settings.batchPromptEnabled} disabled={Boolean(batchProgress)} onChange={(event) => setSettings({ batchPromptEnabled: event.target.checked })} className="accent-blue-500" />
          </label>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>提交方式</span>
            <Select value={settings.batchPromptMode} disabled={Boolean(batchProgress)} onChange={(value) => setSettings({ batchPromptMode: value as AppSettings['batchPromptMode'] })} options={[{ label: '顺序排队', value: 'queue' }, { label: '并发提交', value: 'concurrent' }]} className="rounded-lg bg-black/[0.04] px-3 py-1.5 dark:bg-white/[0.04]" />
          </label>
          {settings.batchPromptMode === 'concurrent' && (
            <>
              <label className="flex items-center justify-between gap-3 text-xs"><span>限制并发数量</span><input type="checkbox" checked={settings.batchPromptConcurrencyLimited} disabled={Boolean(batchProgress)} onChange={(event) => setSettings({ batchPromptConcurrencyLimited: event.target.checked })} className="accent-blue-500" /></label>
              {settings.batchPromptConcurrencyLimited && <label className="flex items-center justify-between gap-3 text-xs"><span>并发数</span><input aria-label="批量并发数" type="number" min={1} value={settings.batchPromptConcurrency ?? DEFAULT_BATCH_PROMPT_CONCURRENCY} disabled={Boolean(batchProgress)} onChange={(event) => setSettings({ batchPromptConcurrency: normalizeBatchPromptConcurrency(Number(event.target.value)) })} className="w-20 rounded-lg bg-black/[0.04] px-3 py-1.5 dark:bg-white/[0.04]" /></label>}
            </>
          )}
          <p className="text-[11px] text-gray-500">每条提示词之间空两行。费用预估仅对应一条提示词，批量会累加费用。</p>
          {batchProgress && <button type="button" onClick={onStopBatch} className="text-xs text-red-500">停止批量提交</button>}
        </ParamPopoverChip>
      )}
    </div>
  )
}
