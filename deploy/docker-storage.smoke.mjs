import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'vite'

for (const opts of [
  { value: 'true', tauri: false, expected: true },
  { value: 'false', tauri: false, expected: false },
  { value: 'true', tauri: true, expected: false },
]) {
  test(`构建后注入 ${opts.value}，客户端标记 ${opts.tauri}`, async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      define: {
        'import.meta.env.VITE_DOCKER_DEPLOYMENT': JSON.stringify('__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__'),
      },
      plugins: [{
        name: 'test-platform',
        enforce: 'pre',
        resolveId: (id) => id === './platform' ? '\0test-platform' : undefined,
        load: (id) => id === '\0test-platform' ? `export const isTauri = ${opts.tauri}` : undefined,
      }],
      build: {
        write: false,
        minify: 'esbuild',
        lib: { entry: resolve('src/lib/dockerStorage.ts'), name: 'DockerStorage', formats: ['iife'] },
      },
    })
    const output = Array.isArray(result) ? result[0].output : result.output
    const chunk = output.find((item) => item.type === 'chunk')
    assert.ok(chunk)
    const code = chunk.code.split('__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__').join(opts.value)
    assert.equal(runInNewContext(code + '\nDockerStorage.isDockerSharedStorage'), opts.expected)
  })
}
