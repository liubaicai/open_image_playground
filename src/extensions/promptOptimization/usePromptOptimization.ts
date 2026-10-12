import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { optimizePrompt } from './api'
import { fetchPromptOptimizationModels, getPromptOptimizationModelCapability, readCachedPromptOptimizationModels } from './catalog'
import { isPromptOptimizationProfile, normalizePromptOptimizationConfig } from './settings'

type Request = { controller: AbortController; prompt: string; route: string }
type Undo = { original: string; optimized: string; route: string }

function getContext() {
  const state = useStore.getState()
  const config = normalizePromptOptimizationConfig(state.settings.promptOptimization, state.settings.profiles)
  const profile = state.settings.profiles.find((item) => item.id === config.profileId)
  // 路由快照仅用于内存内比对，不能记录到日志或持久化。
  const route = JSON.stringify([
    config, profile?.id, profile?.provider, profile?.baseUrl, profile?.apiKey,
    profile?.apiProxy, profile?.codexCli, profile?.timeout, profile?.model, profile?.selectedModel,
    state.settings.activeProfileId, state.reusedTaskApiProfileId, state.reusedTaskApiModel,
    state.appMode, state.filterFavorite, state.activeFavoriteCollectionId,
    window.location.href,
  ])
  return { state, config, profile, route }
}

export function usePromptOptimization(onApply?: () => void) {
  const settings = useStore((state) => state.settings)
  const prompt = useStore((state) => state.prompt)
  const enabled = normalizePromptOptimizationConfig(settings.promptOptimization, settings.profiles).enabled
  const [loading, setLoading] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const requestRef = useRef<Request | null>(null)
  const undoRef = useRef<Undo | null>(null)
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply

  const cancel = useCallback(() => {
    const request = requestRef.current
    if (!request) return
    requestRef.current = null
    request.controller.abort()
    setLoading(false)
  }, [])

  useEffect(() => {
    // 同步订阅可捕获同一轮渲染内“编辑再还原”的变化，避免迟到响应覆盖输入。
    const unsubscribe = useStore.subscribe(() => {
      if (!requestRef.current && !undoRef.current) return
      const context = getContext()
      const request = requestRef.current
      if (request && (context.state.prompt !== request.prompt || context.route !== request.route)) cancel()
      const undo = undoRef.current
      if (undo && (context.state.prompt !== undo.optimized || context.route !== undo.route)) {
        undoRef.current = null
        setCanUndo(false)
      }
    })
    const leave = () => {
      cancel()
      undoRef.current = null
      setCanUndo(false)
    }
    window.addEventListener('pagehide', leave)
    window.addEventListener('beforeunload', leave)
    window.addEventListener('popstate', leave)
    window.addEventListener('hashchange', leave)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', leave)
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('popstate', leave)
      window.removeEventListener('hashchange', leave)
      const request = requestRef.current
      requestRef.current = null
      request?.controller.abort()
      undoRef.current = null
    }
  }, [cancel])

  const optimize = useCallback(async () => {
    if (requestRef.current) return
    const context = getContext()
    if (!context.config.enabled || !context.state.prompt.trim()) return
    if (!context.profile || !isPromptOptimizationProfile(context.profile) || !context.config.model) {
      context.state.showToast('请先在设置中选择提示词优化的 API 配置和文本模型', 'error')
      return
    }
    const request: Request = { controller: new AbortController(), prompt: context.state.prompt, route: context.route }
    requestRef.current = request
    setLoading(true)
    const isCurrent = () => {
      const latest = getContext()
      return requestRef.current === request && !request.controller.signal.aborted
        && latest.state.prompt === request.prompt && latest.route === request.route
    }
    try {
      let models = readCachedPromptOptimizationModels(context.profile)
      try {
        models = await fetchPromptOptimizationModels(context.profile, { signal: request.controller.signal })
      } catch (err) {
        if (!isCurrent()) return
        if (context.profile.provider !== 'openai' || (!context.config.allowUnknownModel && getPromptOptimizationModelCapability(context.config.model, [], context.profile.provider) !== 'verified')) throw err
        // GPT 文本家族按用户指定规则可直接使用；其他未知模型仍须确认，OpenRouter 仍须目录模态校验。
      }
      if (!isCurrent()) return
      const capability = getPromptOptimizationModelCapability(context.config.model, models, context.profile.provider)
      if (capability === 'unsupported') throw new Error('所选模型不支持纯文本输入和输出，请在设置中更换文本模型')
      if (capability !== 'verified' && (context.profile.provider === 'openrouter' || !context.config.allowUnknownModel)) {
        throw new Error(context.profile.provider === 'openrouter'
          ? '无法确认 OpenRouter 模型支持文本输入和输出，请刷新模型列表后重试'
          : '模型的文本能力尚未确认，请在设置中选择文本模型或明确允许未知模型')
      }
      const optimized = await optimizePrompt(context.profile, context.config.model, request.prompt, request.controller.signal)
      if (!isCurrent()) return
      if (!optimized.trim()) throw new Error('模型未返回可用的提示词，请重试或更换文本模型')
      requestRef.current = null
      undoRef.current = { original: request.prompt, optimized, route: request.route }
      onApplyRef.current?.()
      useStore.getState().setPrompt(optimized)
      setCanUndo(true)
      setLoading(false)
      useStore.getState().showToast('提示词已优化，可撤销恢复原文', 'success')
    } catch (err) {
      if (!isCurrent()) return
      console.warn('提示词优化失败', err)
      const message = err instanceof Error ? err.message : '请求失败，请检查 API 配置后重试'
      useStore.getState().showToast(`提示词优化失败：${message}`, 'error')
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null
        setLoading(false)
      }
    }
  }, [])

  const undo = useCallback(() => {
    const saved = undoRef.current
    const context = getContext()
    if (!saved || requestRef.current || context.state.prompt !== saved.optimized || context.route !== saved.route) return
    undoRef.current = null
    setCanUndo(false)
    onApplyRef.current?.()
    context.state.setPrompt(saved.original)
  }, [])

  return { enabled, loading, canUndo, disabled: !prompt.trim() || loading, optimize, cancel, undo }
}
