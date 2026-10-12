import html from '../../index.html?raw'
import manifestText from '../../public/manifest.webmanifest?raw'
import tauriText from '../../src-tauri/tauri.conf.json?raw'
import announcementsText from '../../public/announcements.json?raw'
import license from '../../LICENSE?raw'
import storeSource from '../store.ts?raw'
import imageBlobSource from './imageBlob.ts?raw'
import { describe, expect, it } from 'vitest'

const files: Record<string, string> = { 'index.html': html, 'public/manifest.webmanifest': manifestText, 'src-tauri/tauri.conf.json': tauriText, 'public/announcements.json': announcementsText, LICENSE: license, 'src/store.ts': storeSource, 'src/lib/imageBlob.ts': imageBlobSource }
const read = (path: string) => files[path]

describe('Open Image Playground branding', () => {
  it('uses the new browser, install and native window names', () => {
    expect(read('index.html')).toContain('<title>Open Image Playground</title>')
    const manifest = JSON.parse(read('public/manifest.webmanifest'))
    expect(manifest).toMatchObject({ name: 'Open Image Playground', short_name: 'Open Image' })
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json'))
    expect(tauri.productName).toBe('Open Image Playground')
    expect(tauri.app.windows[0].title).toBe('Open Image Playground')
    expect(tauri.plugins.updater.endpoints).toEqual(['https://github.com/liubaicai/open_image_playground/releases/latest/download/latest.json'])
    expect(tauri.plugins.updater.pubkey).toBeTruthy()
  })
  it('ships no desktop-client recommendation announcement', () => {
    expect(JSON.parse(read('public/announcements.json'))).toEqual([])
  })
  it('preserves copyright and compatibility storage while naming new backups', () => {
    expect(read('LICENSE')).toContain('CookSleep')
    expect(read('src/store.ts')).toContain("name: 'gpt-image-playground'")
    expect(read('src/store.ts')).toContain('`open-image-playground-backup_')
    expect(read('src/lib/imageBlob.ts')).toContain('gpt-image-playground:image-blob-migrated')
  })
})
