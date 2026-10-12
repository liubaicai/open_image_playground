import type { AppSettings } from '../../types'
import { ChevronDownIcon } from '../../components/icons'
import { CHIP_BASE_CLASS, CHIP_IDLE_CLASS } from '../../components/input/paramPopoverChip'
import type { OpenRouterImageModel } from './catalog'
import { getGroupedModelOptions } from './groupedModels'

const POPUP_COLOR_CLASS = 'bg-white text-gray-700 dark:bg-gray-800 dark:text-gray-200'

export default function GroupedModelSelect({ settings, activeProfileId, activeModel, catalog, onChange, disabled = false }: {
  settings: AppSettings
  activeProfileId: string
  activeModel: string
  catalog: OpenRouterImageModel[]
  onChange: (profileId: string, model: string) => void
  disabled?: boolean
}) {
  const groups = getGroupedModelOptions(settings, catalog)
  const options = groups.flatMap((group) => group.options)
  const selected = options.find((option) => option.profileId === activeProfileId && option.model === activeModel)

  return (
    <div className="relative w-48 min-w-0 max-w-full">
      <select
        aria-label="模型"
        style={{ colorScheme: 'light dark' }}
        value={selected?.value ?? ''}
        disabled={disabled || options.length === 0}
        title={selected?.label ?? '请选择模型'}
        onChange={(event) => {
          const option = options.find((item) => item.value === event.target.value)
          if (!disabled && option) onChange(option.profileId, option.model)
        }}
        className={`w-full max-w-full cursor-pointer appearance-none truncate pr-8 disabled:cursor-not-allowed disabled:opacity-50 ${CHIP_BASE_CLASS} ${CHIP_IDLE_CLASS}`}
      >
        {!selected && <option value="" disabled className={POPUP_COLOR_CLASS}>{options.length ? '请选择模型' : '请先启用模型'}</option>}
        {groups.map((group) => (
          <optgroup key={group.provider} label={group.label} className={POPUP_COLOR_CLASS}>
            {group.options.map((option) => <option key={option.value} value={option.value} className={POPUP_COLOR_CLASS}>{option.label}</option>)}
          </optgroup>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
    </div>
  )
}
