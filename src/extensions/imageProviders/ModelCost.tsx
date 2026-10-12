import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ApiProfile } from '../../types'
import { fetchOpenRouterImageModelEndpoints, fetchOpenRouterImageModels, readCachedOpenRouterImageModels, subscribeOpenRouterImageModels, type OpenRouterImageEndpoint } from './catalog'
import { estimateOpenRouterCost } from './pricing'

export default function ModelCost({ profile, n, size, quality, prompt, referenceImageCount }: {
  profile: ApiProfile
  n: number
  size?: string
  quality?: string
  prompt?: string
  referenceImageCount?: number
}) {
  const catalog = useSyncExternalStore(subscribeOpenRouterImageModels, readCachedOpenRouterImageModels, readCachedOpenRouterImageModels)
  const model = catalog.find((item) => item.id === profile.model)
  const [endpointState, setEndpointState] = useState<{ modelId: string; endpoints?: OpenRouterImageEndpoint[]; loading: boolean; error: boolean }>({ modelId: '', loading: false, error: false })
  const [retry, setRetry] = useState(0)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsStyle, setDetailsStyle] = useState<CSSProperties>({})
  const detailsButtonRef = useRef<HTMLButtonElement>(null)
  const detailsPanelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!detailsOpen) return
    const position = () => {
      const rect = detailsButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(384, window.innerWidth - 16)
      setDetailsStyle({
        width,
        left: Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width)),
        ...(rect.top > 160
          ? { bottom: window.innerHeight - rect.top + 8, maxHeight: rect.top - 16 }
          : { top: rect.bottom + 8, maxHeight: Math.max(80, window.innerHeight - rect.bottom - 16) }),
      })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [detailsOpen])

  useEffect(() => {
    if (!detailsOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!detailsButtonRef.current?.contains(event.target as Node) && !detailsPanelRef.current?.contains(event.target as Node)) setDetailsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDetailsOpen(false); detailsButtonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [detailsOpen])

  useEffect(() => {
    if (profile.provider !== 'openrouter' || !profile.model) return
    const controller = new AbortController()
    setDetailsOpen(false)
    setEndpointState({ modelId: profile.model, loading: true, error: false })
    const load = async () => {
      try {
        if (!readCachedOpenRouterImageModels().length) await fetchOpenRouterImageModels({ signal: controller.signal })
        const endpoints = await fetchOpenRouterImageModelEndpoints(profile.model, { signal: controller.signal })
        if (!controller.signal.aborted) setEndpointState({ modelId: profile.model, endpoints, loading: false, error: false })
      } catch {
        if (!controller.signal.aborted) setEndpointState({ modelId: profile.model, loading: false, error: true })
      }
    }
    void load()
    return () => controller.abort()
  }, [profile.provider, profile.model, retry])

  if (profile.provider !== 'openrouter') return null
  const current = endpointState.modelId === profile.model ? endpointState : undefined
  const estimate = model ? estimateOpenRouterCost(model, n, current?.endpoints, { size, quality, prompt, referenceImageCount }) : null
  const label = estimate?.shortLabel ?? estimate?.label ?? '费用预估：未知'

  return (
    <div className="inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400" role="status" aria-live="polite" data-model-cost>
      {!profile.model ? '启用模型后可查看费用预估' : current?.loading ? '正在获取 OpenRouter 定价…' : (
        <>
          <span className="whitespace-nowrap" title={estimate?.label}>{label} · USD</span>
          <button ref={detailsButtonRef} type="button" aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} className="shrink-0 text-blue-600 hover:underline dark:text-blue-400">详情</button>
          {detailsOpen && createPortal(
            <div ref={detailsPanelRef} role="dialog" aria-label="费用估算明细" style={detailsStyle} className="fixed z-[100] overflow-y-auto rounded-xl bg-white/95 p-3 text-xs leading-relaxed text-gray-600 shadow-lg ring-1 ring-black/5 backdrop-blur-xl dark:bg-gray-800/95 dark:text-gray-300 dark:ring-white/[0.08]">
              <p className="mb-1 font-medium">{estimate?.label}</p>
              <p className="break-words">{estimate?.detail ?? '尚无可验证的定价数据，以 OpenRouter 实际计费为准。'}</p>
              {estimate?.sources?.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="mt-1 block text-blue-600 hover:underline dark:text-blue-400">{source.label} ↗</a>)}
            </div>,
            document.body,
          )}
          {current?.error && <button type="button" onClick={() => setRetry((value) => value + 1)} className="shrink-0 text-blue-600 hover:underline dark:text-blue-400" title="定价加载失败">重试定价</button>}
        </>
      )}
    </div>
  )
}
