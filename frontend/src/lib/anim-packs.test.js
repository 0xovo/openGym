// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The animation packs on this device (lib/anim-packs.js): the per-device choice, the bridge to
   the native AnimationPacks plugin and the download a choice or a figure starts. The plugin is a
   stand-in shaped like Capacitor's: a Proxy whose `then` is a native call that never answers (#42). */
const mocks = vi.hoisted(() => ({ MOBILE: true, available: true, ready: new Set(), calls: [], listeners: {}, downloadFails: null }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('@capacitor/core', () => {
  const impl = {
    available: async () => ({ available: mocks.available }),
    status: async ({ packId }) => (mocks.ready.has(packId) ? { state: 'ready', bytes: 5 * 1024 * 1024 } : { state: 'none' }),
    localPath: async ({ packId }) => ({ path: '/var/packs/' + packId }),
    download: async ({ packId, wifiOnly, probe }) => {
      mocks.calls.push(['download', packId, wifiOnly, probe])
      mocks.listeners.progress?.({ packId, fraction: 0.5 })
      if (mocks.downloadFails) throw Object.assign(new Error(mocks.downloadFails), { code: mocks.downloadFails })
      mocks.ready.add(packId)
    },
    remove: async ({ packId }) => { mocks.calls.push(['remove', packId]); mocks.ready.delete(packId) },
    addListener: (ev, fn) => { mocks.listeners[ev] = fn; return { remove() {} } },
  }
  return {
    registerPlugin: name => {
      expect(name).toBe('AnimationPacks')
      return new Proxy({}, { get: (_, k) => impl[k] || (() => new Promise(() => {})) })
    },
    Capacitor: { convertFileSrc: p => 'capacitor://localhost/_capacitor_file_' + p },
  }
})

import * as packs from './anim-packs.js'

const phone = { shortSide: 390 }
beforeEach(() => {
  localStorage.clear()
  mocks.MOBILE = true; mocks.available = true; mocks.ready = new Set(); mocks.calls = []; mocks.listeners = {}; mocks.downloadFails = null
  packs._resetAnimPacks()
})

describe('the choice is this device’s', () => {
  it('defaults to auto over Wi-Fi only, and is kept in localStorage, nowhere else', () => {
    expect(packs.readPrefs()).toEqual({ choice: 'auto', wifiOnly: true })
    packs.writePrefs({ choice: 720, wifiOnly: false })
    expect(JSON.parse(localStorage.getItem(packs.PREFS_KEY))).toEqual({ choice: 720, wifiOnly: false })
    expect(packs.readPrefs()).toEqual({ choice: 720, wifiOnly: false })
  })
  it('reads junk as the defaults', () => {
    localStorage.setItem(packs.PREFS_KEY, '{nope')
    expect(packs.readPrefs()).toEqual({ choice: 'auto', wifiOnly: true })
    localStorage.setItem(packs.PREFS_KEY, JSON.stringify({ choice: 'ultra', wifiOnly: 'yes' }))
    expect(packs.readPrefs()).toEqual({ choice: 'auto', wifiOnly: true })
  })
})

describe('the native side', () => {
  it('reads what is installed, with the folder each pack’s files are served from', async () => {
    mocks.ready.add('anim-360-male')
    await packs.refresh()
    const s = packs.getState()
    expect(s.available).toBe(true)
    expect(packs.installedBases(s)).toEqual({ 'anim-360-male': 'capacitor://localhost/_capacitor_file_/var/packs/anim-360-male' })
    expect(s.packs['anim-360-male'].bytes).toBe(5 * 1024 * 1024)
    expect(s.packs['anim-720-female'].state).toBe('none')
  })
  it('unavailable (older iOS, Android, the sideloaded APK): no packs, nothing asked for', async () => {
    mocks.available = false
    await packs.refresh()
    expect(packs.getState().available).toBe(false)
    expect(packs.ensureWanted('male', phone)).toBeNull()
    expect(mocks.calls).toEqual([])
  })
  it('the web build registers nothing', async () => {
    mocks.MOBILE = false
    await packs.refresh()
    expect(packs.getState()).toMatchObject({ available: false, checked: true })
  })
})

describe('downloads', () => {
  it('auto on a phone fetches the 360 pack of the figure shown, over Wi-Fi only, with a probe the pack holds', async () => {
    await packs.refresh()
    expect(await packs.ensureWanted('female', phone)).toBe('ready')
    expect(mocks.calls).toEqual([['download', 'anim-360-female', true, '2476']])
    expect(packs.getState().packs['anim-360-female']).toMatchObject({ state: 'ready', progress: 1 })
  })
  it('switching figure fetches the other figure’s pack of the same quality; one already there is left alone', async () => {
    mocks.ready.add('anim-720-male')
    packs.writePrefs({ choice: 720 })
    await packs.refresh()
    expect(packs.ensureWanted('male', phone)).toBeNull()
    await packs.ensureWanted('female', phone)
    expect(mocks.calls).toEqual([['download', 'anim-720-female', true, '2476']])
  })
  it('still only and built in download nothing', async () => {
    await packs.refresh()
    for (const choice of ['still', 'builtin']) {
      packs.writePrefs({ choice })
      expect(packs.ensureWanted('male', phone)).toBeNull()
    }
    expect(mocks.calls).toEqual([])
  })
  it('no Wi-Fi: waits for it, and a later try goes ahead', async () => {
    await packs.refresh()
    mocks.downloadFails = 'needs-wifi'
    expect(await packs.download('anim-480-male')).toBe('needs-wifi')
    expect(packs.getState().packs['anim-480-male'].state).toBe('needs-wifi')
    mocks.downloadFails = null
    expect(await packs.download('anim-480-male')).toBe('ready')
  })
  it('a failure is said, and nothing counts as installed', async () => {
    await packs.refresh()
    mocks.downloadFails = 'boom'
    expect(await packs.download('anim-480-male')).toBe('failed')
    expect(packs.installedBases()).toEqual({})
  })
  it('removing a pack takes it off the list', async () => {
    mocks.ready.add('anim-1080-male')
    await packs.refresh()
    expect(await packs.remove('anim-1080-male')).toBe(true)
    expect(packs.installedBases()).toEqual({})
    expect(mocks.calls).toEqual([['remove', 'anim-1080-male']])
  })
})
