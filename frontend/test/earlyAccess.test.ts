import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requestInvitation } from '../src/earlyAccess.ts'

test('invitation requests send the email to the configured backend', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.example/v1/early-access')
    assert.equal(options?.method, 'POST')
    assert.deepEqual(JSON.parse(options?.body as string), { email: 'tester@example.com' })
    return Response.json({ status: 'registered' })
  }
  try { await requestInvitation({ email: 'tester@example.com' }, 'https://api.example/') }
  finally { globalThis.fetch = original }
})

test('failed or malformed responses cannot show signup success', async () => {
  const original = globalThis.fetch
  try {
    for (const response of [Response.json({ status: 'registered' }, { status: 503 }), Response.json({}), new Response('<html>Wrong host</html>')]) {
      globalThis.fetch = async () => response
      await assert.rejects(requestInvitation({ email: 'tester@example.com' }, 'https://api.example'))
    }
    globalThis.fetch = async () => { throw new TypeError('Network failed') }
    await assert.rejects(requestInvitation({ email: 'tester@example.com' }, 'https://api.example'))
  } finally { globalThis.fetch = original }
})
