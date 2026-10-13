// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountSheet, DeleteAccountRow, deleteAccountError } from './DeleteAccount.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Delete my account" on screen: the backup export is offered first, the button does nothing
   until the account's name is typed back, and the server's refusals are said in the UI
   language. The store is a stand-in; what the sheet asks of it and says back is the point. */
const mocks = vi.hoisted(() => {
  const state = { sheets: [] }
  state.toast = vi.fn()
  state.deleteAccount = vi.fn(async () => {})
  state.snapshot = () => ({ user: { id: 'u1', name: 'Mallory' }, deleteAccount: state.deleteAccount })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})

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

function sheet(props = {}) {
  const p = { close: vi.fn(), exportBackup: vi.fn(), exportBackupZip: vi.fn(), done: vi.fn(), hasMedia: false, ...props }
  return { p, host: mount(<DeleteAccountSheet {...p} />) }
}

beforeEach(() => {
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

  it('does nothing until the account name is typed back', async () => {
    const { host } = sheet()
    expect(host.textContent).toContain('Type Mallory to confirm.')
    expect(button(host, 'Delete forever').disabled).toBe(true)
    type(field(host), 'mallory')
    expect(button(host, 'Delete forever').disabled).toBe(true)
    await submit(host)
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    type(field(host), 'Mallory ')
    expect(button(host, 'Delete forever').disabled).toBe(false)
  })

  it('deletes with the typed name, then closes, says goodbye and hands over to Settings', async () => {
    const { p, host } = sheet()
    type(field(host), ' Mallory')
    await submit(host)
    expect(mocks.deleteAccount).toHaveBeenCalledWith('Mallory')
    expect(p.close).toHaveBeenCalled()
    expect(p.done).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Your account is gone. Thanks for every rep.')
  })

  it('the last admin hears why, and the sheet stays open', async () => {
    mocks.deleteAccount.mockRejectedValue(fail(409, { error: 'the last admin cannot leave while other profiles remain', code: 'last-admin' }))
    const { p, host } = sheet()
    type(field(host), 'Mallory')
    await submit(host)
    expect(alertText(host)).toBe('You’re the only admin here, and other profiles still use this server. Make someone else an admin first.')
    expect(p.close).not.toHaveBeenCalled()
    expect(p.done).not.toHaveBeenCalled()
    expect(button(host, 'Delete forever').disabled).toBe(false)   // not stuck on "Deleting…"
  })
})

describe('deleteAccountError', () => {
  it('words each refusal, and anything else as nothing removed', () => {
    expect(deleteAccountError(fail(400, { code: 'confirm-name' }))).toBe('That is not your account name.')
    expect(deleteAccountError(fail(409, { code: 'last-admin' }))).toMatch(/only admin/)
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
