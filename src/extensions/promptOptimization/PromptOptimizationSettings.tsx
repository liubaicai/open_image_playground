import { useEffect, useRef, useState } from 'react'
import type { ApiProfile, AppSettings } from '../../types'
import { splitModelList } from '../../lib/apiProfiles'
import { readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import { Checkbox } from '../../components/Checkbox'
import {
  fetchPromptOptimizationModels,
  getPromptOptimizationModelCapability,
  readCachedPromptOptimizationModels,
} from './catalog'
import {
  getPromptOptimizationRequestUrl,
  isPromptOptimizationProfile,
  normalizePromptOptimizationConfig,
} from './settings'
import type { PromptOptimizationConfig, PromptOptimizationModel } from './types'

interface PromptOptimizationSettingsProps {
  settings: AppSettings
  onChange: (config: PromptOptimizationConfig) => void
}

interface ProfileCatalog {
  profile: ApiProfile
  models: PromptOptimizationModel[]
}

function sameCatalogTarget(a: ApiProfile, b: ApiProfile) {
  return a.id === b.id && a.provider === b.provider && a.baseUrl === b.baseUrl && a.apiKey === b.apiKey &&
    a.apiProxy === b.apiProxy && a.codexCli === b.codexCli && a.apiMode === b.apiMode
}

const INPUT_CLASS = 'w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-800 dark:text-gray-200'

export default function PromptOptimizationSettings({ settings, onChange }: PromptOptimizationSettingsProps) {
  const config = normalizePromptOptimizationConfig(settings.promptOptimization, settings.profiles)
  const profiles = settings.profiles.filter(isPromptOptimizationProfile)
  const [catalogs, setCatalogs] = useState<ProfileCatalog[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [manualProfileId, setManualProfileId] = useState('')
  const [manualModel, setManualModel] = useState('')
  const requestRef = useRef<{ controller: AbortController, profiles: ApiProfile[] } | null>(null)
  const latestProfilesRef = useRef(profiles)
  latestProfilesRef.current = profiles

  const profileLabels = new Map(profiles.map((profile) => [profile.id, `${profile.name}${profiles.some((other) => other.id !== profile.id && other.name === profile.name) ? ` (${profile.id})` : ''}`]))
  const modelsFor = (profile: ApiProfile) => catalogs.find((entry) => sameCatalogTarget(entry.profile, profile))?.models ?? readCachedPromptOptimizationModels(profile)
  const options = profiles.flatMap((profile) => {
    const models = modelsFor(profile)
    const ids = [...new Set([
      ...models.map((model) => model.id),
      ...splitModelList(profile.model),
      ...(profile.id === config.profileId && config.model ? [config.model] : []),
    ])]
    return ids.flatMap((model) => {
      const capability = getPromptOptimizationModelCapability(model, models, profile.provider)
      if (capability === 'unsupported' || (profile.provider === 'openrouter' && capability !== 'verified')) return []
      const entry = models.find((item) => item.id === model)
      return [{
        profile, model, capability,
        value: JSON.stringify([profile.id, model]),
        label: `${entry?.name && entry.name !== model ? `${entry.name} (${model})` : model} · ${profileLabels.get(profile.id)}${capability === 'unknown' ? ' · 能力未验证' : ''}`,
      }]
    })
  })
  const selectedProfile = profiles.find((profile) => profile.id === config.profileId)
  const selectedOption = options.find((option) => option.profile.id === config.profileId && option.model === config.model)
  const capability = selectedProfile ? getPromptOptimizationModelCapability(config.model, modelsFor(selectedProfile), selectedProfile.provider) : 'unsupported'
  const unknown = selectedProfile?.provider === 'openai' && Boolean(config.model) && capability === 'unknown'
  const openaiProfiles = profiles.filter((profile) => profile.provider === 'openai')
  const manualProfile = openaiProfiles.find((profile) => profile.id === manualProfileId) ?? openaiProfiles[0]
  const manualUnsupported = Boolean(manualProfile && manualModel.trim() && getPromptOptimizationModelCapability(manualModel.trim(), modelsFor(manualProfile), manualProfile.provider) === 'unsupported')

  let destination = ''
  let destinationError = ''
  if (selectedProfile) {
    try {
      const url = getPromptOptimizationRequestUrl(selectedProfile)
      destination = url.startsWith('/') ? new URL(url, window.location.href).href : url
    } catch (err) {
      destinationError = err instanceof Error ? err.message : '服务地址无效，请检查 API 配置'
    }
  }
  const usesProxy = selectedProfile?.provider === 'openai' && shouldUseApiProxy(selectedProfile.apiProxy)
  const proxyTarget = usesProxy ? readClientDevProxyConfig()?.target : ''
  const canEnable = Boolean(selectedOption && destination && (capability === 'verified' || (unknown && config.allowUnknownModel)))

  useEffect(() => {
    const request = requestRef.current
    if (request && (request.profiles.length !== profiles.length || request.profiles.some((profile) => !profiles.some((current) => sameCatalogTarget(profile, current))))) {
      request.controller.abort()
      requestRef.current = null
      setLoading(false)
      setErrors([])
    }
  }, [settings.profiles])

  useEffect(() => () => requestRef.current?.controller.abort(), [])

  const refresh = async () => {
    requestRef.current?.controller.abort()
    const controller = new AbortController()
    const targets = profiles
    const request = { controller, profiles: targets }
    requestRef.current = request
    setLoading(true)
    setErrors([])
    const results = await Promise.all(targets.map(async (profile) => {
      try {
        const models = await fetchPromptOptimizationModels(profile, { signal: controller.signal, force: true })
        return { profile, models, error: '' }
      } catch (err) {
        return { profile, models: null, error: `${profile.name}：${err instanceof Error ? err.message : '模型目录加载失败'}` }
      }
    }))
    // 关闭面板或更换连接后，晚到的目录不能覆盖新配置，也不能自动保存设置。
    if (controller.signal.aborted || requestRef.current !== request) return
    const current = results.filter((result) => latestProfilesRef.current.some((profile) => sameCatalogTarget(result.profile, profile)))
    setCatalogs((previous) => [
      ...previous.filter((entry) => !current.some((result) => result.models && result.profile.id === entry.profile.id)),
      ...current.flatMap((result) => result.models ? [{ profile: result.profile, models: result.models }] : []),
    ])
    setErrors(current.map((result) => result.error).filter(Boolean))
    setLoading(false)
    requestRef.current = null
  }

  const select = (profileId: string, model: string) => {
    onChange({ enabled: false, profileId, model, allowUnknownModel: false })
  }

  return (
    <section aria-label="提示词优化" className="space-y-3 rounded-xl border border-gray-200/70 bg-black/[0.02] p-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">提示词优化</h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">使用独立的文本模型按主体、动作、场景、构图、光色、风格和画质细化提示词，保留原意与明确限制。默认关闭；选择模型后需单独启用。</p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="prompt-optimization-model" className="text-xs font-medium text-gray-600 dark:text-gray-300">优化文本模型</label>
          <button type="button" disabled={!profiles.length || loading} onClick={() => void refresh()} className="text-xs text-blue-600 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400">
            {loading ? '加载中…' : errors.length ? '重试加载文本模型' : '刷新文本模型目录'}
          </button>
        </div>
        <select id="prompt-optimization-model" aria-label="优化文本模型" value={selectedOption?.value ?? ''} className={INPUT_CLASS} style={{ colorScheme: 'light dark' }} onChange={(event) => {
          const option = options.find((item) => item.value === event.target.value)
          if (option) select(option.profile.id, option.model)
        }}>
          <option value="" disabled>{config.model && !selectedOption ? `${capability === 'unknown' ? '当前选择待验证' : '当前选择不可用'}：${config.model}` : '请选择文本模型'}</option>
          {(['openai', 'openrouter'] as const).map((provider) => {
            const group = options.filter((option) => option.profile.provider === provider)
            return group.length > 0 && <optgroup key={provider} label={provider === 'openai' ? 'OpenAI / 兼容服务' : 'OpenRouter'}>
              {group.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          })}
        </select>
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">目录仅用于查看模型，不会发起优化或生成请求。OpenRouter 只显示明确支持文本输入和文本输出的模型；刷新不会自动启用。</p>
        {!profiles.length && <p className="text-xs text-amber-600 dark:text-amber-400">请先添加 OpenAI 或 OpenRouter API 配置。</p>}
        {profiles.some((profile) => profile.provider === 'openrouter' && modelsFor(profile).length === 0) && <p className="text-[11px] text-gray-500 dark:text-gray-400">OpenRouter 文本目录尚未加载，请刷新后选择。</p>}
        {errors.map((error, index) => <p key={index} role="alert" className="break-words text-xs text-red-600 dark:text-red-400">{error}。已有设置保持不变。</p>)}
      </div>

      {openaiProfiles.length > 0 && <details className="text-xs">
        <summary className="cursor-pointer text-gray-600 dark:text-gray-300">手动指定 OpenAI / 兼容服务模型</summary>
        <div className="mt-2 space-y-2">
          <select aria-label="手动模型 API 配置" value={manualProfile?.id ?? ''} onChange={(event) => setManualProfileId(event.target.value)} className={INPUT_CLASS} style={{ colorScheme: 'light dark' }}>
            {openaiProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profileLabels.get(profile.id)}</option>)}
          </select>
          <input type="text" aria-label="手动文本模型 ID" value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder="输入文本模型 ID" autoComplete="off" className={INPUT_CLASS} />
          <button type="button" disabled={!manualProfile || !manualModel.trim() || manualUnsupported} onClick={() => { if (manualProfile && manualModel.trim() && !manualUnsupported) select(manualProfile.id, manualModel.trim()) }} className="rounded-lg bg-black/[0.05] px-3 py-1.5 text-xs text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.08] dark:text-gray-200">使用此模型</button>
          {manualUnsupported && <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">此模型不支持文本输入和文本输出，不能用于提示词优化。</p>}
        </div>
      </details>}

      {selectedProfile && config.model && <div className="space-y-1.5 rounded-lg bg-white/70 p-2.5 text-[11px] leading-relaxed text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
        <p>使用配置：{profileLabels.get(selectedProfile.id)} · {config.model}</p>
        {destination && <p className="break-all">请求地址：{destination}</p>}
        {usesProxy && <p className="break-all text-amber-700 dark:text-amber-400">{proxyTarget ? `通过部署代理转发，上游地址：${proxyTarget}。代理服务也会接收提示词和此配置的鉴权信息。` : '通过部署代理转发；实际上游由服务器配置，无法在前端验证。代理服务也会接收提示词和此配置的鉴权信息。'}</p>}
        <p>只有点击输入框旁的“优化”按钮时，才向上述服务发送当前提示词文本及优化指令，不发送图片、附件或对话历史。使用所选配置现有的 API Key，不另存一份。</p>
        <p className="font-medium text-amber-700 dark:text-amber-400">每次优化可能产生额外文本模型费用，具体价格与数据处理方式由服务商决定。</p>
      </div>}
      {destinationError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{destinationError}</p>}
      {config.model && (!selectedOption || capability === 'unsupported') && <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">{capability === 'unknown' ? '尚未验证所选模型的文本能力，请刷新文本模型目录后再启用。' : '所选模型或配置当前不可用于文本优化，请刷新目录或重新选择。'}</p>}
      {unknown && <div className="space-y-2 rounded-lg border border-amber-300/60 p-2.5 dark:border-amber-500/30">
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">此服务的目录没有提供可验证的文本能力信息。模型名称不能保证兼容；请求可能失败，也可能产生费用。</p>
        <Checkbox aria-label="确认未验证模型兼容性" checked={config.allowUnknownModel} onChange={(checked) => onChange({ ...config, enabled: false, allowUnknownModel: checked })} label="我确认此模型支持文本聊天，愿意尝试" />
      </div>}
      <div className="border-t border-gray-200/70 pt-3 dark:border-white/[0.08]">
        <Checkbox aria-label="启用提示词优化" checked={config.enabled} disabled={!config.enabled && !canEnable} onChange={(enabled) => { if (!enabled || canEnable) onChange({ ...config, enabled }) }} label="启用提示词优化" />
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">启用表示你已了解上述发送目标及潜在费用。更换模型或连接配置后需要重新启用；启用本身不会发送提示词。</p>
      </div>
    </section>
  )
}
