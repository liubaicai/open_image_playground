// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseInfo } from '../lib/releaseUpdates'
import Header from './Header'
import HelpModal from './HelpModal'
import SupportPromptModal from './SupportPromptModal'
import AboutSettingsTab from './settings/AboutSettingsTab'

const mocks = vi.hoisted(() => ({
  store: {
    appMode: 'gallery', setAppMode: vi.fn(), setShowSettings: vi.fn(), setConfirmDialog: vi.fn(),
    agentMobileHeaderVisible: true, agentConversations: [], activeAgentConversationId: null,
    filterFavorite: false, activeFavoriteCollectionId: null as string | null, createAgentConversation: vi.fn(),
    supportPromptOpen: true, dismissSupportPrompt: vi.fn(), confirmDialog: null, detailTaskId: null,
    lightboxImageId: null, showSettings: false, maskEditorImageId: null, sketchBoard: null, showToast: vi.fn(),
  },
  releases: { releases: [] as ReleaseInfo[], checkError: '', pages: 0, ignoredVersion: '' },
  checkForUpdates: vi.fn(), setUpdateModalOpen: vi.fn(),
}))
vi.mock('../store', () => ({ useStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store) }))
vi.mock('../hooks/useReleaseUpdates', () => ({
  useReleaseUpdates: (selector: (state: typeof mocks.releases) => unknown) => selector(mocks.releases),
  checkForUpdates: mocks.checkForUpdates, setUpdateModalOpen: mocks.setUpdateModalOpen,
}))
vi.mock('../hooks/useCloseOnEscape', () => ({ useCloseOnEscape: () => {} }))
vi.mock('../hooks/usePreventBackgroundScroll', () => ({ usePreventBackgroundScroll: () => {} }))
vi.mock('../lib/platform', () => ({ isTauri: false }))
vi.mock('./FavoriteCollections', () => ({ useFavoriteCollectionTitle: () => '测试收藏夹' }))
vi.mock('./HistoryModal', () => ({ default: () => null }))

let root: ReturnType<typeof createRoot> | null = null
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const PROJECT_URL = 'https://github.com/liubaicai/open_image_playground'
const UPSTREAM_URL = 'https://github.com/CookSleep/gpt_image_playground'
const SPONSOR_LABEL = '赞助原作者(CookSleep/gpt_image_playground)'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.releases.releases = []
  mocks.releases.pages = 0
  mocks.releases.checkError = ''
  mocks.store.appMode = 'gallery'
  mocks.store.filterFavorite = false
  mocks.store.activeFavoriteCollectionId = null
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function render(component: ReactNode) {
  const el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () => root!.render(component))
  return document.body
}

function linkWithText(el: HTMLElement, text: string) {
  return [...el.querySelectorAll('a')].find((link) => link.textContent?.trim() === text)
}

describe('Open Image Playground 项目品牌', () => {
  it('页眉及收藏夹视图使用新名称和仓库', async () => {
    const el = await render(<Header />)
    expect(linkWithText(el, 'Open Image Playground')?.getAttribute('href')).toBe(PROJECT_URL)
    expect(el.textContent).not.toContain('GPT Image Playground')
    mocks.store.activeFavoriteCollectionId = 'collection'
    await act(async () => root!.render(<Header />))
    expect(el.textContent).toContain('测试收藏夹')
    expect(linkWithText(el, 'Open Image Playground')?.getAttribute('href')).toBe(PROJECT_URL)
  })

  it.each([390, 1280])('宽度 %i 下旧 Agent 模式也没有模式切换、对话入口或 Agent 帮助', async (width) => {
    vi.stubGlobal('innerWidth', width)
    mocks.store.appMode = 'agent'
    mocks.store.agentMobileHeaderVisible = false
    const el = await render(<Header />)
    expect(el.textContent).not.toContain('Agent')
    expect(el.querySelector('[title="历史任务"]')).toBeNull()
    expect(el.querySelector('[title="新对话"]')).toBeNull()
    expect(el.querySelector('header')?.className).not.toContain('-translate-y-full')
    expect([...el.querySelectorAll('button')].some((button) => button.textContent?.trim() === '画廊')).toBe(false)

    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="操作指南"]')!.click())
    expect(el.textContent).toContain('多选任务')
    expect(el.textContent).not.toContain('Agent')
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click())
    expect(el.textContent).not.toContain('多选任务')
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="设置"]')!.click())
    expect(mocks.store.setShowSettings).toHaveBeenCalledWith(true)
    expect(mocks.store.setAppMode).not.toHaveBeenCalled()
    expect(mocks.store.createAgentConversation).not.toHaveBeenCalled()
  })

  it('收藏夹帮助可反复打开与关闭', async () => {
    mocks.store.filterFavorite = true
    const el = await render(<Header />)
    for (let i = 0; i < 2; i++) {
      await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="操作指南"]')!.click())
      expect(el.textContent).toContain('多选收藏夹')
      await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click())
      expect(el.textContent).not.toContain('多选收藏夹')
    }
  })

  it('Windows 网页不再推广下载客户端，保留 PWA 和更新入口', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    vi.resetModules()
    const { default: WindowsHeader } = await import('./Header')
    mocks.releases.releases = [{ version: '99.0.0', tag: 'v99.0.0', body: '', publishedAt: '', url: `${PROJECT_URL}/releases/tag/v99.0.0` }]
    const el = await render(<WindowsHeader />)
    expect(el.querySelector('[aria-label="下载客户端"]')).toBeNull()
    expect(el.querySelector('[aria-label="安装为应用"]')).not.toBeNull()
    await act(async () => el.querySelector<HTMLButtonElement>('[title="新版本 v99.0.0"]')!.click())
    expect(mocks.setUpdateModalOpen).toHaveBeenCalledWith(true)
  })

  it('关于页使用新作者和反馈仓库，并保留原项目、原作者和 MIT 归属', async () => {
    const el = await render(<AboutSettingsTab onOpenFontLicenses={() => {}} />)
    expect(linkWithText(el, 'Open Image Playground')?.getAttribute('href')).toBe(PROJECT_URL)
    expect(linkWithText(el, '@liubaicai')?.getAttribute('href')).toBe('https://github.com/liubaicai')
    expect(el.querySelector('[aria-label="GitHub 仓库"]')?.getAttribute('href')).toBe(PROJECT_URL)
    expect(linkWithText(el, '反馈问题')?.getAttribute('href')).toBe(`${PROJECT_URL}/issues`)
    expect(linkWithText(el, 'CookSleep/gpt_image_playground')?.getAttribute('href')).toBe(UPSTREAM_URL)
    expect(linkWithText(el, '@CookSleep')?.getAttribute('href')).toBe('https://github.com/CookSleep')
    expect(linkWithText(el, 'MIT 许可')?.getAttribute('href')).toBe(`${UPSTREAM_URL}/blob/main/LICENSE`)
    expect(linkWithText(el, SPONSOR_LABEL)?.getAttribute('href')).toBe('https://www.ifdian.net/a/cooksleep')
  })

  it('无 Release 时显示仓库暂无已发布版本，更新日志入口继续工作', async () => {
    mocks.releases.pages = 1
    mocks.checkForUpdates.mockResolvedValue(undefined)
    const el = await render(<AboutSettingsTab onOpenFontLicenses={() => {}} />)
    expect(el.textContent).toContain('暂无已发布版本')
    await act(async () => [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('检查更新'))!.click())
    expect(mocks.store.showToast).toHaveBeenCalledWith('此仓库暂无已发布版本', 'info')
    await act(async () => [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('更新日志'))!.click())
    expect(mocks.setUpdateModalOpen).toHaveBeenCalledWith(true)
  })

  it('帮助链接打开新项目，赞助提示保留原赞助目标并清楚标注原作者', async () => {
    const el = await render(<HelpModal onClose={() => {}} />)
    expect(linkWithText(el, 'Open Image Playground')?.getAttribute('href')).toBe(PROJECT_URL)
    await act(async () => root!.render(<SupportPromptModal />))
    expect(linkWithText(el, SPONSOR_LABEL)?.getAttribute('href')).toBe('https://www.ifdian.net/a/cooksleep')
    expect(linkWithText(el, '反馈问题')?.getAttribute('href')).toBe(`${PROJECT_URL}/issues`)
    expect(el.textContent).not.toContain('欢迎赞助作者')
  })
})
