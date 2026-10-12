import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ApiProfile } from '../../types'
import { splitModelList } from '../../lib/apiProfiles'
import { fetchOpenRouterImageModels, readCachedOpenRouterImageModels, subscribeOpenRouterImageModels } from './catalog'
import { getEnabledProfileModels } from './modelPreferences'
import { describeOpenRouterPricing } from './pricing'

interface ModelSettingsProps {
  profile: ApiProfile
  onChange: (patch: Partial<ApiProfile>) => void
  disabled?: boolean
}

export default function ModelSettings({ profile, onChange, disabled = false }: ModelSettingsProps) {
  const catalog = useSyncExternalStore(subscribeOpenRouterImageModels, readCachedOpenRouterImageModels, readCachedOpenRouterImageModels)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const isOpenRouter = profile.provider === 'openrouter'
  const enabled = getEnabledProfileModels(profile)
  const configured = splitModelList(profile.model)
  const catalogById = useMemo(() => new Map(catalog.map((model) => [model.id, model])), [catalog])
  const allIds = isOpenRouter ? [...new Set([...catalog.map((model) => model.id), ...configured])] : configured
  const visibleIds = allIds.filter((id) => {
    const model = isOpenRouter ? catalogById.get(id) : undefined
    return `${id} ${model?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  })

  const refresh = async (force = false) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      await fetchOpenRouterImageModels({ signal: controller.signal, force })
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : '模型目录加载失败，请重试')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    setQuery('')
    setError('')
    setLoading(false)
    if (profile.provider === 'openrouter' && !disabled) {
      const cached = readCachedOpenRouterImageModels()
      if (!cached.length) void refresh()
    }
    return () => requestRef.current?.abort()
  }, [profile.id, profile.provider, disabled])

  const changeEnabled = (ids: string[]) => {
    onChange({
      ...(isOpenRouter ? { model: allIds.join(', ') } : {}),
      enabledModels: ids,
      selectedModel: ids.includes(profile.selectedModel ?? '') ? profile.selectedModel : ids[0],
    })
  }

  return (
    <section className="space-y-2 rounded-xl border border-gray-200/70 bg-black/[0.02] p-3 dark:border-white/[0.08] dark:bg-white/[0.02]" aria-label="启用模型">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-200">启用模型 <span className="font-normal text-gray-400">{enabled.length} / {allIds.length}</span></div>
        {isOpenRouter && (
          <button type="button" disabled={disabled || loading} onClick={() => void refresh(true)} className="text-xs text-blue-600 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400">
            {loading ? '加载中…' : error ? '重试加载目录' : '刷新模型目录'}
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        {isOpenRouter ? '仅列出支持图像输出的模型。勾选后才会出现在生成器中；刷新不会自动启用新模型。' : '勾选需要在生成器中显示的模型。可在上方模型列表中添加模型 ID。'}
      </p>
      {isOpenRouter && catalog.some((model) => model.source === 'public') && <p className="text-[11px] text-amber-600 dark:text-amber-400">前端目录暂不可用，当前使用 OpenRouter 官方公共目录。</p>}
      {error && <p role="alert" className="break-words text-xs text-red-600 dark:text-red-400">{error}，已有选择仍会保留。</p>}
      {allIds.length > 5 && (
        <input aria-label="搜索模型" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称或 ID" className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-white/[0.04]" />
      )}
      <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
        {visibleIds.map((id) => {
          const model = isOpenRouter ? catalogById.get(id) : undefined
          const unavailable = isOpenRouter && catalog.length > 0 && !model?.supportsImageApi
          const checked = enabled.includes(id)
          const prices = model ? describeOpenRouterPricing(model) : []
          return (
            <label key={id} className={`flex items-start gap-2.5 rounded-lg p-2 ${disabled || (unavailable && !checked) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'}`}>
              <input type="checkbox" checked={checked} disabled={disabled || (unavailable && !checked)} onChange={() => changeEnabled(checked ? enabled.filter((value) => value !== id) : [...enabled, id])} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-500" aria-label={`启用 ${id}`} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xs text-gray-700 dark:text-gray-200">{model?.name ?? id}</span>
                {model && model.name !== id && <span className="block break-all text-[10px] text-gray-400">{id}</span>}
                {unavailable
                  ? <span className="block text-[10px] text-amber-600 dark:text-amber-400">当前图像 API 未提供此模型</span>
                  : prices.length > 0 && <span className="block text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">{prices.join(' · ')}</span>}
              </span>
            </label>
          )
        })}
        {!visibleIds.length && <p className="py-3 text-center text-xs text-gray-400">{loading ? '正在读取模型目录…' : query ? '没有匹配的模型' : isOpenRouter ? '尚无模型，请刷新目录' : '请先添加模型 ID'}</p>}
      </div>
      {allIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <button type="button" disabled={disabled || enabled.length === 0} onClick={() => changeEnabled([])} className="text-gray-500 hover:text-gray-700 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-200">全部停用</button>
          {isOpenRouter && <a href="https://openrouter.ai/models?fmt=cards&output_modalities=image" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400">OpenRouter 模型与定价 ↗</a>}
        </div>
      )}
      {enabled.length === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">尚未启用模型，启用至少一个模型后才能生成图像。</p>}
    </section>
  )
}
