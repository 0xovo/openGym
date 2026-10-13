// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountSheet, DeleteAccountRow, deleteAccountError } from './DeleteAccount.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Delete my account" on screen: the backup export is offered first, nothing goes on until the
   account's name is typed back, then the owner's proof (ProveOwner, the same step the other
   changes to a way in ask) carries the delete. The server's refusals are said in the UI
   language. The store and the API are stand-ins; what the sheet sends and says is the point. */
const mocks = vi.hoisted(() => {
  const state = { sheets: [], MOBILE: false, webauthn: true, proofs: { passkeys: [{ id: 'k1' }], password: true } }
  state.toast = vi.fn()
  state.deleteAccount = vi.fn(async () => {})
  state.passkeyAssertion = vi.fn(async () => ({ cid: 'c1', credential: { id: 'k1' } }))
  state.api = vi.fn(async path => { if (path === '/api/account/passkeys') return state.proofs; return {} })
  state.snapshot = () => ({ user: { id: 'u1', name: 'Mallory' }, deleteAccount: state.deleteAccount })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a),
  webauthnOK: () => mocks.webauthn,
  passkeyAssertion: (...a) => mocks.passkeyAssertion(...a),
  passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const fail = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
function type(el, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const submit = async host => { act(() => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await settle() }
const alertText = host => host.querySelector('[role="alert"]')?.textContent || null
const field = host => host.querySelector('input[placeholder="Account name"]')
const password = host => host.querySelector('input[placeholder="Current password"]')
// Past the name: typed, and "Continue".
async function toProof(host, name = 'Mallory') {
  await settle()   // what can prove it, read as the sheet opens
  type(field(host), name)
  await submit(host)
}

function sheet(props = {}) {
  const p = { close: vi.fn(), exportBackup: vi.fn(), exportBackupZip: vi.fn(), done: vi.fn(), hasMedia: false, ...props }
  return { p, host: mount(<DeleteAccountSheet {...p} />) }
}

beforeEach(() => {
  mocks.MOBILE = false
  mocks.webauthn = true
  mocks.proofs = { passkeys: [{ id: 'k1' }], password: true }
  mocks.api.mockClear()
  mocks.passkeyAssertion.mockClear()
  mocks.sheets.length = 0
  mocks.toast.mockClear()
  mocks.deleteAccount.mockReset()
  mocks.deleteAccount.mockImplementation(async () => {})
})
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove() }
})

describe('DeleteAccountSheet', () => {
  it('offers the backup export first: the JSON one, or the zip when there are photos and videos', () => {
    const plain = sheet()
    act(() => button(plain.host, 'Export backup (JSON)').click())
    expect(plain.p.exportBackup).toHaveBeenCalledTimes(1)
    expect(button(plain.host, 'Export with photos & videos (.zip)')).toBeUndefined()

    const media = sheet({ hasMedia: true })
    act(() => button(media.host, 'Export with photos & videos (.zip)').click())
    expect(media.p.exportBackupZip).toHaveBeenCalledTimes(1)
  })

  it('goes nowhere until the account name is typed back', async () => {
    const { host } = sheet()
    await settle()
    expect(host.textContent).toContain('Type Mallory to confirm.')
    expect(button(host, 'Continue').disabled).toBe(true)
    type(field(host), 'mallory')
    expect(button(host, 'Continue').disabled).toBe(true)
    await submit(host)
    expect(host.textContent).not.toContain('First confirm that it is you.')
    type(field(host), 'Mallory ')
    expect(button(host, 'Continue').disabled).toBe(false)
    await submit(host)
    expect(host.textContent).toContain('First confirm that it is you.')
    expect(mocks.deleteAccount).not.toHaveBeenCalled()   // the name alone deletes nothing
  })

  it('the passkey proves it and carries the delete; then it closes, says goodbye and hands over', async () => {
    const { p, host } = sheet()
    await toProof(host, ' Mallory')
    await act(async () => { button(host, 'Confirm with a passkey').click() })
    await settle()
    expect(mocks.passkeyAssertion).toHaveBeenCalled()
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', { cid: 'c1', credential: { id: 'k1' } })
    expect(p.close).toHaveBeenCalled()
    expect(p.done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Your account is gone. Thanks for every rep.')
  })

  it('or the current password, where it counts', async () => {
    const { host } = sheet()
    await toProof(host)
    type(password(host), 'correct horse battery staple')
    await submit(host)
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory', { current: 'correct horse battery staple' })
  })

  it('a wrong password is said, and nothing is gone', async () => {
    mocks.deleteAccount.mockRejectedValue(fail(403, { error: 'your current password is not right', code: 'current-wrong' }))
    const { p, host } = sheet()
    await toProof(host)
    type(password(host), 'nope nope nope')
    await submit(host)
    expect(alertText(host)).toBe('Your current password is not right.')
    expect(p.close).not.toHaveBeenCalled()
    expect(p.done).not.toHaveBeenCalled()
  })

  it('the last admin hears why, and the sheet stays open', async () => {
    mocks.deleteAccount.mockRejectedValue(fail(409, { error: 'the last admin cannot leave while other profiles remain', code: 'last-admin' }))
    const { p, host } = sheet()
    await toProof(host)
    type(password(host), 'correct horse battery staple')
    await submit(host)
    expect(alertText(host)).toBe('You’re the only admin here, and other profiles still use this server. Make someone else an admin first.')
    expect(p.close).not.toHaveBeenCalled()
  })

  it('the phone app offers no passkey, which it cannot hold for the server, only the password', async () => {
    mocks.MOBILE = true
    const { host } = sheet()
    await toProof(host)
    expect(button(host, 'Confirm with a passkey')).toBeUndefined()
    expect(password(host)).toBeTruthy()
  })

  it('a phone with no password to prove it says where to do it instead', async () => {
    mocks.MOBILE = true
    mocks.proofs = { passkeys: [{ id: 'k1' }], password: false }
    const { host } = sheet()
    await toProof(host)
    expect(host.textContent).toContain('This app can’t confirm with a passkey. Delete your account from openGym in your browser, or add a password there first.')
    expect(password(host)).toBeNull()
  })
})

describe('deleteAccountError', () => {
  it('words each refusal, and anything else as nothing removed', () => {
    expect(deleteAccountError(fail(400, { code: 'confirm-name' }))).toBe('That is not your account name.')
    expect(deleteAccountError(fail(409, { code: 'last-admin' }))).toMatch(/only admin/)
    expect(deleteAccountError(fail(403, { code: 'passkey' }))).toBe('Your passkey could not be confirmed.')
    expect(deleteAccountError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toBe('Your passkey could not be confirmed.')
    expect(deleteAccountError(fail(500, {}))).toBe('Couldn’t delete the account. Nothing was removed.')
    expect(deleteAccountError(new TypeError('Failed to fetch'))).toBe('Couldn’t delete the account. Nothing was removed.')
  })
})

describe('DeleteAccountRow', () => {
  it('opens the sheet with what Settings hands it', () => {
    const exportBackup = vi.fn()
    const host = mount(<DeleteAccountRow exportBackup={exportBackup} hasMedia={false} />)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Delete my account')).click())
    expect(mocks.sheets).toHaveLength(1)
    const inner = mount(mocks.sheets[0].render(() => {}))
    act(() => button(inner, 'Export backup (JSON)').click())
    expect(exportBackup).toHaveBeenCalled()
  })
})
