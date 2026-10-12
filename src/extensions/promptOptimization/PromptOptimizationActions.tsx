import type { usePromptOptimization } from './usePromptOptimization'

export default function PromptOptimizationActions({ optimizer }: { optimizer: ReturnType<typeof usePromptOptimization> }) {
  if (!optimizer.enabled) return null
  const buttonClass = 'flex items-center justify-center rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-blue-400'
  return (
    <>
      {optimizer.loading ? (
        <button type="button" onClick={optimizer.cancel} className={buttonClass} title="取消优化" aria-label="取消优化">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
        </button>
      ) : optimizer.canUndo ? (
        <button type="button" onClick={optimizer.undo} className={buttonClass} title="撤销提示词优化" aria-label="撤销提示词优化">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4 4 9l5 5M4 9h9a7 7 0 0 1 0 14" transform="translate(0 -2)" /></svg>
        </button>
      ) : null}
      <button type="button" onClick={() => void optimizer.optimize()} disabled={optimizer.disabled} className={buttonClass} title={optimizer.loading ? '正在优化提示词' : '优化提示词'} aria-label="优化提示词" aria-busy={optimizer.loading}>
        {optimizer.loading ? (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" className="opacity-25" /><path d="M12 3a9 9 0 0 1 9 9" /></svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 20 11-11 3 3L7 23zM13 11l3 3M5 3v4M3 5h4M18 2v4M16 4h4M20 16v4M18 18h4" transform="translate(0 -1)" /></svg>
        )}
      </button>
    </>
  )
}
