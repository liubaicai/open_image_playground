import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile } from '../../types'
import { MAX_OPTIMIZATION_PROMPT_LENGTH, MAX_OPTIMIZED_PROMPT_LENGTH, optimizePrompt, parseOptimizedPrompt, PROMPT_OPTIMIZATION_TIMEOUT_MS } from './api'

const profile = (patch: Partial<ApiProfile> = {}): ApiProfile => ({
  id: 'text', name: 'Text', provider: 'openai', baseUrl: 'https://text.example/v1', apiKey: 'test-secret', model: 'unrelated-image-model',
  timeout: 600, apiMode: 'images', codexCli: false, apiProxy: false, transparentBackgroundMethod: 'local', ...patch,
})
const output = (content: unknown = '优化后的提示词') => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('text-only prompt optimizer API', () => {
  it('sends only the current prompt and rewrite policy through the selected profile and text model', async () => {
    const fetch = vi.fn().mockResolvedValue(json(output('  保留三个红苹果，左侧留白。  ')))
    vi.stubGlobal('fetch', fetch)
    expect(await optimizePrompt(profile(), 'custom-text-model', '三个红苹果，左侧留白')).toBe('保留三个红苹果，左侧留白。')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://text.example/v1/chat/completions')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' } })
    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model', 'stream'])
    expect(body).toMatchObject({ model: 'custom-text-model', stream: false, max_completion_tokens: 4000 })
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1]).toEqual({ role: 'user', content: '三个红苹果，左侧留白' })
    expect(body.messages[0].content).toContain('Preserve the original language')
    expect(body.messages[0].content).toContain('Do not invent extra main subjects')
    expect(body.messages[0].content).toContain('reference-image mentions')
    for (const heading of ['主体对象', '动作/状态', '环境/场景', '构图/视角', '光影/色彩', '艺术风格/媒介', '画质/参数']) expect(body.messages[0].content).toContain(heading)
    expect(body.messages[0].content).toContain('Add plausible creative details')
    expect(body.messages[0].content).toContain('settings remain authoritative')
    expect(body.messages[0].content).toContain('Do not emit unsupported Midjourney')
    expect(body.messages[0].content).toContain('untrusted prompt data')
    expect(body.max_completion_tokens).toBeLessThanOrEqual(4000)
    expect(JSON.stringify(body)).not.toContain('test-secret')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('forces text-only OpenRouter output at the official direct endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(json(output()))
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')
    await optimizePrompt(profile({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/', apiProxy: true }), 'maker/text', 'A cat')
    expect(fetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ max_tokens: 4000, modalities: ['text'] })
  })

  it('respects OpenAI custom paths, proxy configuration, and changed credentials', async () => {
    const fetch = vi.fn().mockImplementation(async () => json(output()))
    vi.stubGlobal('fetch', fetch)
    await optimizePrompt(profile({ baseUrl: 'https://other.example/custom/', apiKey: 'updated' }), 'custom', 'Prompt')
    expect(fetch.mock.calls[0][0]).toBe('https://other.example/custom/chat/completions')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer updated')
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    await optimizePrompt(profile({ apiProxy: true, apiKey: '', baseUrl: '' }), 'custom', 'Prompt')
    expect(fetch.mock.calls[1][0]).toBe('/api-proxy/chat/completions')
    expect(fetch.mock.calls[1][1].headers.Authorization).toBeUndefined()
  })

  it('rejects empty input, excessive input, missing models, unsupported providers, and unsafe OpenRouter addresses before sending', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(optimizePrompt(profile(), 'text', ' ')).rejects.toThrow('请先输入')
    await expect(optimizePrompt(profile(), 'text', 'x'.repeat(MAX_OPTIMIZATION_PROMPT_LENGTH + 1))).rejects.toThrow('过长')
    await expect(optimizePrompt(profile(), '', 'Prompt')).rejects.toThrow('请先选择')
    await expect(optimizePrompt(profile({ baseUrl: '' }), 'text', 'Prompt')).rejects.toThrow('API 地址')
    await expect(optimizePrompt(profile(), 'gpt-image-2', 'Prompt')).rejects.toThrow('非文本')
    await expect(optimizePrompt(profile({ provider: 'fal' }), 'text', 'Prompt')).rejects.toThrow('仅支持')
    await expect(optimizePrompt(profile({ provider: 'openrouter' }), 'text', 'Prompt')).rejects.toThrow('官方')
    await expect(optimizePrompt(profile({ provider: 'openrouter', baseUrl: '', apiKey: '' }), 'text', 'Prompt')).rejects.toThrow('API Key')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('parses string and text-only content parts and preserves line breaks', () => {
    expect(parseOptimizedPrompt(output('  hello\nworld  '))).toBe('hello\nworld')
    expect(parseOptimizedPrompt(output([{ type: 'text', text: 'hello' }, { type: 'text', text: '\nworld' }]))).toBe('hello\nworld')
  })

  it.each([
    null, {}, { choices: [] }, { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { content: 'text' } }, { message: { content: 'another' } }] },
    output(null), output([{ type: 'image_url', image_url: { url: 'https://example.test/image.png' } }]),
    { choices: [{ finish_reason: 'length', message: { content: 'truncated' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: 'blocked' } }] },
    { choices: [{ message: { content: 'text', tool_calls: [{}] } }] },
    { choices: [{ message: { content: 'text', refusal: 'No' } }] },
    { choices: [{ message: { content: 'text', images: [{}] } }] },
    output('```text\nprompt\n```'), output('x'.repeat(MAX_OPTIMIZED_PROMPT_LENGTH + 1)),
  ])('rejects malformed, non-text, incomplete, or excessive result %#', (payload) => {
    expect(() => parseOptimizedPrompt(payload)).toThrow()
  })

  it('never exposes echoed key or prompt in HTTP, API, malformed JSON, or network errors and never retries', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ error: { message: 'test-secret PRIVATE PROMPT' } }, 401))
      .mockResolvedValueOnce(json({ error: { message: 'test-secret PRIVATE PROMPT' } }))
      .mockResolvedValueOnce(new Response('test-secret PRIVATE PROMPT'))
      .mockRejectedValueOnce(new Error('提示词优化 test-secret PRIVATE PROMPT'))
    vi.stubGlobal('fetch', fetch)
    for (let index = 0; index < 4; index++) {
      const error = await optimizePrompt(profile(), 'text', 'PRIVATE PROMPT').catch((value: Error) => value)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).not.toMatch(/test-secret|PRIVATE PROMPT/)
      expect(fetch).toHaveBeenCalledTimes(index + 1)
    }
  })

  it('limits actual response bytes as well as requested model output', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(' '.repeat(256 * 1024 + 1)))
    vi.stubGlobal('fetch', fetch)
    await expect(optimizePrompt(profile(), 'text', 'Prompt')).rejects.toThrow('响应过大')
  })

  it('honors cancellation and caps the request timeout even if the image profile permits ten minutes', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    }))
    vi.stubGlobal('fetch', fetch)
    const aborted = new AbortController()
    aborted.abort()
    await expect(optimizePrompt(profile(), 'text', 'Prompt', aborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
    const controller = new AbortController()
    const cancelled = expect(optimizePrompt(profile(), 'text', 'Prompt', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await cancelled
    const request = expect(optimizePrompt(profile(), 'text', 'Prompt')).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(PROMPT_OPTIMIZATION_TIMEOUT_MS)
    await request
    expect(vi.getTimerCount()).toBe(0)
  })
})
