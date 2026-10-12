// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({
  state: {
    appMode: 'agent',
    filterFavorite: false,
    activeFavoriteCollectionId: null as string | null,
    settings: { writeLogFile: false, saveLocationMode: 'browser', autoCheckUpdate: false },
  },
  initStore: vi.fn(() => new Promise<void>(() => {})),
  loadAgentModule: vi.fn(),
  mountAgent: vi.fn(() => <div data-agent-workspace />),
}))

vi.mock('./store', () => ({
  initStore: mocks.initStore,
  useStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}))
vi.mock('./lib/apiProfiles', () => ({
  createDefaultOpenAIProfile: vi.fn(), hasDefaultPresetConfig: () => false, normalizeSettings: vi.fn(),
}))
vi.mock('./lib/customProviderConfigUrl', () => ({
  getCustomProviderConfigUrl: () => '', hasEmbeddedDefaultConfig: () => false,
  loadCustomProviderSettingsFromUrl: vi.fn(), loadEmbeddedDefaultConfig: vi.fn(),
}))
vi.mock('./lib/presetConfig', () => ({
  getDefaultPresetProfileId: vi.fn(), getPresetProfileIds: vi.fn(), isPresetConfigOnlyEnabled: () => false, setPresetConfig: vi.fn(),
}))
vi.mock('./hooks/useDockerApiUrlMigrationNotice', () => ({ useDockerApiUrlMigrationNotice: () => {} }))
vi.mock('./hooks/useAppFonts', () => ({ useAppFonts: () => {} }))
vi.mock('./hooks/useCloseConfirm', () => ({ useCloseConfirm: () => {} }))
vi.mock('./hooks/useSaveLocationPrompt', () => ({ useSaveLocationPrompt: () => {} }))
vi.mock('./hooks/useImportLinks', () => ({ useImportLinks: () => {}, promptImportLink: vi.fn() }))
vi.mock('./hooks/useReleaseUpdates', () => ({ useAutoUpdateCheck: () => {} }))
vi.mock('./lib/clickSuppression', () => ({ useGlobalClickSuppression: () => {} }))
vi.mock('./lib/dbTauri', () => ({ takeDataDirNotice: vi.fn() }))
vi.mock('./lib/platform', () => ({ isTauri: false }))
vi.mock('./lib/saveFile', () => ({ setSaveToDefaultDir: vi.fn() }))
vi.mock('./lib/tauriLog', () => ({ setTauriLogEnabled: vi.fn() }))
vi.mock('./lib/tauriStorage', () => ({ getTauriStorageLoadError: vi.fn() }))
vi.mock('./components/startupNotice', () => ({ showStartupNotices: vi.fn() }))
vi.mock('./components/Header', () => ({ default: () => <header /> }))
vi.mock('./components/SearchBar', () => ({ default: () => <div data-gallery-search /> }))
vi.mock('./components/TaskGrid', () => ({ default: () => <div data-gallery-tasks /> }))
vi.mock('./components/InputBar', () => ({ default: () => <div data-gallery-composer /> }))
vi.mock('./components/AgentWorkspace', () => {
  mocks.loadAgentModule()
  return { default: mocks.mountAgent }
})
vi.mock('./components/DetailModal', () => ({ default: () => null }))
vi.mock('./components/Lightbox', () => ({ default: () => null }))
vi.mock('./components/SettingsModal', () => ({ default: () => null }))
vi.mock('./components/UpdateModal', () => ({ default: () => null }))
vi.mock('./components/ConfirmDialog', () => ({ default: () => null }))
vi.mock('./components/DataProgressDialog', () => ({ default: () => null }))
vi.mock('./components/Toast', () => ({ default: () => null }))
vi.mock('./components/DbBlockedNotice', () => ({ default: () => null }))
vi.mock('./components/MaskEditorModal', () => ({ default: () => null }))
vi.mock('./components/SketchBoardModal', () => ({ default: () => null }))
vi.mock('./components/ImageContextMenu', () => ({ default: () => null }))
vi.mock('./components/SupportPromptModal', () => ({ default: () => null }))
vi.mock('./components/AnnouncementModal', () => ({ default: () => null }))
vi.mock('./components/FavoriteCollections', () => ({
  FavoriteCollectionPickerModal: () => null,
  FavoriteCollectionsView: () => <div data-gallery-collections />,
  ManageCollectionsModal: () => null,
}))

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  mocks.state.appMode = 'agent'
  mocks.state.filterFavorite = false
  mocks.state.activeFavoriteCollectionId = null
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  window.history.replaceState(null, '', '/')
})

async function render() {
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root!.render(<App />))
  return el
}

describe('画廊专用应用入口', () => {
  it.each(['/', '/?mode=agent', '/#agent', '/agent'])('旧入口 %s 和持久化 Agent 模式仍展示画廊', async (url) => {
    window.history.replaceState(null, '', url)
    const el = await render()
    expect(el.querySelector('[data-home-main]')).not.toBeNull()
    expect(el.querySelector('[data-gallery-search]')).not.toBeNull()
    expect(el.querySelector('[data-gallery-tasks]')).not.toBeNull()
    expect(el.querySelector('[data-gallery-composer]')).not.toBeNull()
    expect(el.querySelector('[data-agent-workspace]')).toBeNull()
    expect(mocks.loadAgentModule).not.toHaveBeenCalled()
    expect(mocks.mountAgent).not.toHaveBeenCalled()
  })

  it('旧 Agent 模式下收藏夹总览和具体收藏夹依然可切换', async () => {
    mocks.state.filterFavorite = true
    const el = await render()
    expect(el.querySelector('[data-gallery-collections]')).not.toBeNull()
    expect(el.querySelector('[data-gallery-tasks]')).toBeNull()
    mocks.state.activeFavoriteCollectionId = 'collection-a'
    await act(async () => root!.render(<App />))
    expect(el.querySelector('[data-gallery-collections]')).toBeNull()
    expect(el.querySelector('[data-gallery-tasks]')).not.toBeNull()
    expect(mocks.mountAgent).not.toHaveBeenCalled()
  })
})
