import { expect, it, vi } from 'vitest'
import { downloadImageIds } from '../../lib/downloadImages'
const mocks = vi.hoisted(() => ({ saveFile: vi.fn().mockResolvedValue('saved'), apiFetch: vi.fn() }))
vi.mock('../../lib/platform', () => ({ isTauri: false, apiFetch: mocks.apiFetch }))
vi.mock('../../lib/imageCache', () => ({ ensureImageCached: vi.fn() }))
vi.mock('../../lib/saveFile', () => ({ saveFile: mocks.saveFile, saveFileToDir: vi.fn(), pickSaveDir: vi.fn() }))
it('downloads returned vector images with a truthful .svg extension', async () => {
  mocks.apiFetch.mockResolvedValue(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } }))
  const result = await downloadImageIds(['data:image/svg+xml;base64,PHN2Zy8+'], 'openrouter-vector')
  expect(result.successCount).toBe(1)
  expect(mocks.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'openrouter-vector.svg')
})
