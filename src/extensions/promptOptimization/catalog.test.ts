import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import {
  fetchPromptOptimizationModels,
  getPromptOptimizationModelCapability,
  normalizePromptOptimizationModels,
  OPENROUTER_TEXT_MODELS_URL,
  readCachedPromptOptimizationModels,
} from './catalog'

const profile = (provider = 'openai'): ApiProfile => ({
  id: 'text', name: 'Text', provider, baseUrl: provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://text.example/v1',
  apiKey: 'test-secret', model: 'image-model', timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local',
})
const row = (id: string, input = ['text'], output = ['text']) => ({ id, architecture: { input_modalities: input, output_modalities: output } })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('prompt optimization text catalog', () => {
  it('requires both text input and output metadata, preserving unknown and incompatible status', () => {
    const models = normalizePromptOptimizationModels({ data: [
      row('text'), row('vision', ['text', 'image']), row('multi', ['text'], ['image', 'text']),
      row('image', ['text'], ['image']), row('audio', ['audio'], ['text']),
      { id: 'mystery' }, { id: 'one-side', input_modalities: ['text'] },
      { id: 'gpt-image-2' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' },
    ] }, 'openai')
    expect(models.filter((model) => model.capability === 'verified').map((model) => model.id)).toEqual(['text', 'vision', 'multi'])
    expect(models.filter((model) => model.capability === 'unknown').map((model) => model.id)).toEqual(['mystery', 'one-side'])
    expect(models.filter((model) => model.capability === 'unsupported').map((model) => model.id)).toEqual(['image', 'audio', 'gpt-image-2', 'text-embedding-3-small', 'whisper-1'])
  })

  it('does not infer OpenRouter compatibility by model name or architecture label', () => {
    const models = normalizePromptOptimizationModels([{ id: 'gpt-4.1', architecture: { modality: 'text->text' } }, { id: 'claude-text' }], 'openrouter')
    expect(models.every((model) => model.capability === 'unknown')).toBe(true)
    expect(getPromptOptimizationModelCapability('gpt-4.1', models, 'openrouter')).toBe('unknown')
    expect(getPromptOptimizationModelCapability('missing', models)).toBe('unknown')
    expect(getPromptOptimizationModelCapability('openai/gpt-image-2', [])).toBe('unsupported')
    expect(getPromptOptimizationModelCapability('gpt-4o-mini-tts', [])).toBe('unsupported')
  })

  it.each([
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-2025-04-14', 'gpt-5', 'gpt-5-mini',
    'openai/gpt-4o', 'vendor/openai/GPT-4.1', 'VENDOR/GPT-5:latest', 'ft:gpt-4o-mini:org:custom',
  ])('makes OpenAI GPT model %s usable without metadata or confirmation', (id) => {
    const [model] = normalizePromptOptimizationModels([{ id }], 'openai')
    expect(model.capability).toBe('verified')
    expect(getPromptOptimizationModelCapability(id, [], 'openai')).toBe('verified')
    expect(getPromptOptimizationModelCapability(id, [{ ...model, capability: 'unknown' }], 'openai')).toBe('verified')
    expect(getPromptOptimizationModelCapability(id, [])).toBe('unknown')
    expect(getPromptOptimizationModelCapability(id, [], 'openrouter')).toBe('unknown')
    expect(normalizePromptOptimizationModels([{ id }], 'openrouter')[0].capability).toBe('unknown')
  })

  it.each([
    'gpt-image', 'gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-1.5-2025-12-16',
    'openai/gpt-image-1', 'vendor/openai/GPT-IMAGE-1.5', 'vendor:GPT-IMAGE-1:latest', 'gpt-image-preview',
  ])('always excludes GPT image model %s, even when catalog metadata claims text support', (id) => {
    for (const provider of ['openai', 'openrouter'] as const) {
      expect(normalizePromptOptimizationModels([{ id }, row(id)], provider)[0].capability).toBe('unsupported')
      expect(getPromptOptimizationModelCapability(id, [], provider)).toBe('unsupported')
      expect(getPromptOptimizationModelCapability(id, [{
        id, name: id, inputModalities: ['text'], outputModalities: ['text'], capability: 'verified',
      }], provider)).toBe('unsupported')
    }
  })

  it.each([
    'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-tts', 'gpt-4o-realtime-preview',
    'gpt-realtime', 'vendor/openai/GPT-4O-MINI-TTS:latest',
  ])('preserves known nonchat audio exclusions for %s', (id) => {
    expect(normalizePromptOptimizationModels([{ id }, row(id)], 'openai')[0].capability).toBe('unsupported')
    expect(getPromptOptimizationModelCapability(id, [], 'openai')).toBe('unsupported')
  })

  it('keeps explicit contradictory GPT metadata unsupported', () => {
    const models = normalizePromptOptimizationModels([
      row('gpt-4o', ['audio'], ['text']), row('gpt-4.1', ['text'], ['image']),
      { id: 'gpt-5', input_modalities: [] }, { id: 'vendor/GPT-5-mini', output_modalities: ['audio'] },
      row('gpt-4o'), { id: 'gpt-4.1' },
    ], 'openai')
    expect(models).toHaveLength(4)
    for (const model of models) {
      expect(model.capability).toBe('unsupported')
      expect(getPromptOptimizationModelCapability(model.id, models, 'openai')).toBe('unsupported')
    }
  })

  it.each(['custom-text', 'claude-sonnet', 'gemini-pro', 'o3', 'my-gpt-4o'])('keeps non-GPT model %s unknown without metadata', (id) => {
    expect(normalizePromptOptimizationModels([{ id }], 'openai')[0].capability).toBe('unknown')
    expect(getPromptOptimizationModelCapability(id, [], 'openai')).toBe('unknown')
  })

  it('sanitizes malformed rows and handles duplicate contradictory metadata conservatively', () => {
    expect(() => normalizePromptOptimizationModels({ error: 'bad' }, 'openai')).toThrow('格式')
    const models = normalizePromptOptimizationModels([null, {}, { id: '' }, row('duplicate'), row('duplicate', ['text'], ['image']), row('duplicate')], 'openai')
    expect(models).toHaveLength(1)
    expect(models[0].capability).toBe('unsupported')
  })

  it('fetches the full public OpenRouter catalog without auth, image filtering, or slicing', async () => {
    const p = profile('openrouter')
    const fetch = vi.fn().mockResolvedValue(json({ data: Array.from({ length: 1700 }, (_, index) => row(`maker/model-${index}`)) }))
    vi.stubGlobal('fetch', fetch)
    const models = await fetchPromptOptimizationModels(p)
    expect(models).toHaveLength(1700)
    expect(fetch).toHaveBeenCalledWith(OPENROUTER_TEXT_MODELS_URL, expect.objectContaining({ headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error' }))
    expect(await fetchPromptOptimizationModels(p)).toBe(models)
    expect(readCachedPromptOptimizationModels(p)).toBe(models)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses selected OpenAI current credentials and effective proxy for /models', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const p = { ...profile(), apiProxy: true }
    const fetch = vi.fn().mockResolvedValue(json({ data: [{ id: 'custom-text' }] }))
    vi.stubGlobal('fetch', fetch)
    expect((await fetchPromptOptimizationModels(p))[0].capability).toBe('unknown')
    expect(fetch).toHaveBeenCalledWith('/api-proxy/models', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer test-secret' } }))
  })

  it('follows safe same-endpoint pagination and detects incomplete responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ data: [row('first')], links: { next: '?offset=1' }, total_count: 2 }))
      .mockResolvedValueOnce(json({ data: [row('last')], total_count: 2 }))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchPromptOptimizationModels(profile('openrouter'))).toHaveLength(2)
    expect(fetch.mock.calls[1][0]).toBe(`${OPENROUTER_TEXT_MODELS_URL}?offset=1`)
    fetch.mockResolvedValueOnce(json({ data: [row('only')], has_more: true }))
    await expect(fetchPromptOptimizationModels(profile())).rejects.toThrow('不完整')
    fetch.mockResolvedValueOnce(json({ data: [], total_count: 2 }))
    await expect(fetchPromptOptimizationModels(profile())).rejects.toThrow('不完整')
  })

  it.each(['https://evil.example/models', 'https://text.example/v1/chat/completions', 'https://name:password@text.example/v1/models'])('does not forward credentials through unsafe page links %s', async (next) => {
    const fetch = vi.fn().mockResolvedValue(json({ data: [], links: { next } }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchPromptOptimizationModels(profile())).rejects.toThrow('分页地址无效')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed and provider errors without exposing provider bodies or network secrets', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ error: { message: 'test-secret PRIVATE PROMPT' } }, 401))
      .mockResolvedValueOnce(new Response('not JSON'))
      .mockResolvedValueOnce(json({ error: 'test-secret' }))
      .mockRejectedValueOnce(new Error('文本模型目录 test-secret PRIVATE PROMPT'))
    vi.stubGlobal('fetch', fetch)
    for (let index = 0; index < 4; index++) {
      const error = await fetchPromptOptimizationModels(profile()).catch((value: Error) => value)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toMatch(/test-secret|PRIVATE PROMPT/)
    }
  })

  it('does not initiate an already cancelled fetch and aborts pending requests within 20 seconds', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchPromptOptimizationModels(profile(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    const request = expect(fetchPromptOptimizationModels(profile())).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(20000)
    await request
    expect(vi.getTimerCount()).toBe(0)
  })
})
