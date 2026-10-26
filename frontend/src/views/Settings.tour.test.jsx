// @vitest-environment happy-dom
// Settings → About & updates → Show the tour again: the app tour from the top, from anywhere,
// but not over a running workout (its practice session would stand in for the real one).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { tourState, closeTour, markTourDone } from '../lib/tour.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const toast = mocks.toast = vi.fn()
  const snap = () => ({ toast, openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, workouts: [], routines: [], exWeights: {}, active: null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  closeTour()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  closeTour()
  localStorage.clear()
})

const row = () => [...host.querySelectorAll('.lrow')].find(b => b.textContent.includes('Show the tour again'))

describe('Settings: Show the tour again', () => {
  it('starts the tour from the top, also after it was seen', () => {
    markTourDone()
    act(() => root.render(<Settings page="about" />))
    act(() => row().click())
    expect(tourState()).toEqual({ kind: 'run', at: null })
  })
  it('waits for a running workout to end', () => {
    mocks.S.active = { id: 'a', entries: [] }
    act(() => root.render(<Settings page="about" />))
    act(() => row().click())
    expect(tourState()).toBe(null)
    expect(mocks.toast).toHaveBeenCalledWith('Finish your workout first, then the tour is all yours.')
  })
})
