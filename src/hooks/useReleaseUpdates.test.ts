import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_CACHE_TTL_MS, RELEASE_REPO } from '../lib/releaseUpdates'

const records = vi.hoisted(() => new Map<string, string>())
const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../lib/platform', () => ({ apiFetch }))
vi.mock('../lib/localRecord', () => ({
  readLocal: (key: string) => records.get(key) ?? null,
  writeLocal: (key: string, value: string) => { records.set(key, value) },
}))

const cacheKey = `release-cache-v1:${RELEASE_REPO}`
const ignoredKey = `ignored-release-version:${RELEASE_REPO}`
const apiUrl = 'https://api.github.com/repos/liubaicai/open_image_playground/releases?per_page=10&page=1'
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const release = {
  tag: 'v0.9.0', version: '0.9.0', body: 'Fork release', publishedAt: '',
  url: 'https://github.com/liubaicai/open_image_playground/releases/tag/v0.9.0',
}
const cache = (fetchedAt = Date.now()) => JSON.stringify({ fetchedAt, pages: 1, hasMore: false, releases: [release] })

beforeEach(() => {
  records.clear()
  apiFetch.mockReset()
  vi.resetModules()
})

describe('Release checks for the current repository', () => {
  it('fetches the fork release API and stores results under its repository-scoped key', async () => {
    apiFetch.mockResolvedValueOnce(json([{ tag_name: release.tag, body: release.body, html_url: release.url }]))
    const updates = await import('./useReleaseUpdates')
    expect(await updates.checkForUpdates()).toEqual(release)
    expect(apiFetch).toHaveBeenCalledExactlyOnceWith(apiUrl, { headers: { Accept: 'application/vnd.github+json' } })
    expect(updates.useReleaseUpdates.getState()).toMatchObject({ releases: [release], pages: 1, hasMore: false, checkError: '' })
    expect(JSON.parse(records.get(cacheKey)!)).toMatchObject({ releases: [release], pages: 1 })
    expect(records.has('release-cache-v1')).toBe(false)
  })

  it.each([200, 404])('treats empty releases (HTTP %i) as no available release, not a fake latest version', async (status) => {
    records.set(cacheKey, cache(Date.now() - RELEASE_CACHE_TTL_MS))
    apiFetch.mockResolvedValueOnce(json(status === 404 ? { message: 'Not Found' } : [], status))
    const updates = await import('./useReleaseUpdates')
    expect(await updates.checkForUpdates()).toBeUndefined()
    expect(updates.useReleaseUpdates.getState()).toMatchObject({ releases: [], pages: 1, hasMore: false, checkError: '' })
    expect(JSON.parse(records.get(cacheKey)!)).toMatchObject({ releases: [], pages: 1, hasMore: false })
    expect(await updates.checkForUpdates()).toBeUndefined()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('never restores legacy or another repository cache and ignored versions, preserving unrelated records', async () => {
    records.set('release-cache-v1', cache())
    records.set('ignored-release-version', '99.0.0')
    records.set('release-cache-v1:CookSleep/gpt_image_playground', cache())
    records.set('ignored-release-version:CookSleep/gpt_image_playground', '99.0.0')
    records.set('settings', 'unrelated settings')
    const original = new Map(records)
    apiFetch.mockResolvedValueOnce(json([]))
    const updates = await import('./useReleaseUpdates')
    expect(updates.useReleaseUpdates.getState().ignoredVersion).toBe('')
    expect(await updates.checkForUpdates()).toBeUndefined()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(updates.useReleaseUpdates.getState().releases).toEqual([])
    updates.ignoreReleaseVersion('0.9.0')
    expect(records.get(ignoredKey)).toBe('0.9.0')
    for (const [key, value] of original) expect(records.get(key)).toBe(value)
  })

  it('restores only this repository cache and ignored version without fetching a fresh cache again', async () => {
    records.set(cacheKey, cache())
    records.set(ignoredKey, '0.9.0')
    records.set('ignored-release-version', '99.0.0')
    const updates = await import('./useReleaseUpdates')
    expect(updates.useReleaseUpdates.getState().ignoredVersion).toBe('0.9.0')
    expect(await updates.checkForUpdates()).toEqual(release)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it.each([403, 429])('keeps HTTP %i rate limits as errors without falling back to legacy releases', async (status) => {
    records.set('release-cache-v1', cache())
    apiFetch.mockResolvedValueOnce(json({ message: 'API rate limit exceeded' }, status))
    const updates = await import('./useReleaseUpdates')
    await expect(updates.checkForUpdates()).rejects.toThrow('GitHub 请求过于频繁')
    expect(updates.useReleaseUpdates.getState()).toMatchObject({ releases: [], pages: 0, checkError: 'GitHub 请求过于频繁，请稍后再试' })
    expect(records.has(cacheKey)).toBe(false)
  })

  it('preserves only this repository stale cache on network failure and exposes the error', async () => {
    const saved = cache(Date.now() - RELEASE_CACHE_TTL_MS)
    records.set(cacheKey, saved)
    apiFetch.mockRejectedValueOnce(new Error('network unavailable'))
    const updates = await import('./useReleaseUpdates')
    await expect(updates.checkForUpdates()).rejects.toThrow('network unavailable')
    expect(updates.useReleaseUpdates.getState()).toMatchObject({ releases: [release], checkError: 'network unavailable' })
    expect(records.get(cacheKey)).toBe(saved)
  })

  it('retains other HTTP failures as errors and allows a later successful check', async () => {
    apiFetch.mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json([]))
    const updates = await import('./useReleaseUpdates')
    await expect(updates.checkForUpdates()).rejects.toThrow('HTTP 500')
    expect(await updates.checkForUpdates()).toBeUndefined()
    expect(updates.useReleaseUpdates.getState().checkError).toBe('')
  })

  it('treats a missing later page as the end of history and keeps already loaded fork releases', async () => {
    records.set(cacheKey, cache())
    const updates = await import('./useReleaseUpdates')
    await updates.checkForUpdates()
    apiFetch.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
    await updates.loadOlderReleases()
    expect(apiFetch).toHaveBeenCalledWith(apiUrl.replace('&page=1', '&page=2'), expect.any(Object))
    expect(updates.useReleaseUpdates.getState()).toMatchObject({ releases: [release], pages: 2, hasMore: false, checkError: '' })
  })
})
