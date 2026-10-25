// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #614: Settings → Reminders → Gym reminder. The native side is mocked (lib/gym-reminder.js has
// its own tests); this checks the page's flow: off by default, the explainer before any system
// prompt, "Always" asked only after it, the gyms list, the time window and the editor's save.
const mocks = vi.hoisted(() => ({
  config: { on: false, gyms: [], window: null },
  perm: { location: 'prompt', background: 'prompt', notifications: 'granted' },
  saved: [], asked: [], confirm: true, nav: vi.fn(), toast: vi.fn(), menu: null, location: { state: null },
  here: { lat: 47.3769, lng: 8.5417, accuracy: 12 },
  native: false, picked: undefined, pickCalls: [], searches: [], hits: [], sheet: null, opened: [],
}))
// The places side: the iPhone's picker and the search, controlled per test (lib/gym-places.js has
// its own tests for the search's manners).
vi.mock('../lib/gym-places.js', async () => {
  const real = await vi.importActual('../lib/gym-places.js')
  return {
    ...real,
    hasNativePicker: async () => mocks.native,
    pickOnNativeMap: async o => { mocks.pickCalls.push(o); return mocks.picked },
    searchPlaces: async (q, o) => { mocks.searches.push([q, o]); return mocks.hits },
  }
})
vi.mock('../lib/gym-reminder.js', async () => {
  const real = await vi.importActual('../lib/gym-reminder.js')
  return {
    ...real,
    loadGymConfig: async () => ({ config: real.normConfig(mocks.config), permission: mocks.perm }),
    saveGymConfig: async c => { mocks.saved.push(real.normConfig(c)); mocks.config = real.normConfig(c); return { watching: c.on ? c.gyms.length : 0, permission: mocks.perm } },
    gymPermissions: async () => mocks.perm,
    askForegroundLocation: async () => { mocks.asked.push('foreground'); mocks.perm = { ...mocks.perm, location: 'granted' }; return mocks.perm },
    askBackgroundLocation: async () => { mocks.asked.push('background'); mocks.perm = { ...mocks.perm, background: 'granted' }; return mocks.perm },
    currentPosition: async () => mocks.here,
    openAppSettings: vi.fn(),
  }
})
vi.mock('../sheets.jsx', () => ({
  confirmSheet: o => { mocks.asked.push('explainer'); if (mocks.confirm) o.onConfirm?.(); else o.onCancel?.() },
  menuSheet: o => { mocks.menu = o },
}))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: fn => { mocks.sheet = fn } })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { workouts: [] } })
  const useStore = sel => (sel ? sel(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useLocation: () => mocks.location }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }) },
}))
// The map is Leaflet in the phone app; here a stand-in that records what the page asks of it.
vi.mock('leaflet', () => {
  const layer = () => ({ addTo() { return this }, on() { return this }, setLatLng() {}, setOpacity() {}, setStyle() {}, setRadius() {}, getLatLng: () => ({ lat: 0, lng: 0 }), options: { opacity: 0 } })
  const L = {
    map: () => ({ setView() { return this }, attributionControl: { setPrefix() {} }, on() {}, invalidateSize() {}, remove() {}, getZoom: () => 2, distance: () => 0 }),
    tileLayer: layer, marker: layer, circle: layer, divIcon: () => ({}), control: { zoom: () => ({ addTo() {} }) },
  }
  return { default: L, ...L }
})
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import GymReminderPage, { GymEditPage } from './GymReminder.jsx'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const render = async el => { await act(async () => { root.render(el) }); await flush() }
const rowByText = text => [...host.querySelectorAll('.lrow, .row, [class*="row"]')].find(e => e.textContent.includes(text))
const switchIn = text => rowByText(text)?.querySelector('[role="switch"], input[type="checkbox"], button')
const click = async el => { await act(async () => { el.click() }); await flush() }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const byLabel = label => host.querySelector(`[aria-label="${label}"]`)
const gymsConfig = () => ({ on: true, gyms: [
  { id: 'a', name: 'Downtown', address: 'Main St 1, 8000 Zürich', lat: 47.37, lng: 8.54, radius: 150, text: '' },
  { id: 'b', name: 'Uptown', lat: 47.4, lng: 8.5, radius: 100, text: 'Legs today' },
], window: null })

beforeEach(() => {
  mocks.config = { on: false, gyms: [], window: null }
  mocks.perm = { location: 'prompt', background: 'prompt', notifications: 'granted' }
  mocks.saved = []; mocks.asked = []; mocks.confirm = true; mocks.menu = null; mocks.location = { state: null }
  mocks.native = false; mocks.picked = undefined; mocks.pickCalls = []; mocks.searches = []; mocks.hits = []; mocks.sheet = null
  mocks.nav.mockClear(); mocks.toast.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Gym reminder page', () => {
  it('off by default, with a friendly empty list and an Add button', async () => {
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Gym reminder')
    expect(host.textContent).toContain('Your gyms')
    expect(host.textContent).toContain('No gyms yet.')
    expect(btn('Add a gym')).toBeTruthy()
    const sw = switchIn('Gym reminder')
    expect(sw.getAttribute('aria-checked') ?? String(sw.checked)).toMatch(/false/)
    // the places never leave the phone, and it says so
    expect(host.textContent).toContain('Your gyms stay on this phone')
  })

  it('turning it on explains first, then asks while-in-use, then Always, then saves', async () => {
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual(['explainer', 'foreground', 'background'])
    expect(mocks.saved.at(-1).on).toBe(true)
  })

  it('"Not now" on the explainer: no system prompt, stays off', async () => {
    mocks.confirm = false
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual(['explainer'])
    expect(mocks.saved).toEqual([])
  })

  it('Always already given: no explainer, straight on', async () => {
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual([])
    expect(mocks.saved.at(-1).on).toBe(true)
  })

  it('lists the gyms as cards with address and radius; a tap opens the editor', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    const cards = host.querySelectorAll('.gym-list .gym-item')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Downtown')
    expect(cards[0].textContent).toContain('Main St 1, 8000 Zürich')
    expect(cards[0].textContent).toContain('150 m around the pin')
    expect(cards[1].textContent).toContain('Legs today')
    // swipe to remove, like Plan's routines
    expect(host.querySelectorAll('.swrow')).toHaveLength(2)
    await click(cards[0].querySelector('.item-open'))
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { id: 'a' } })
  })

  it('a switch per gym: off keeps it on the list, on again drops the flag', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    await click(byLabel('Remind me at Uptown'))
    expect(mocks.saved.at(-1).gyms.find(g => g.id === 'b').off).toBe(true)
    expect(mocks.saved.at(-1).gyms).toHaveLength(2)
    expect(host.querySelectorAll('.gym-item.off')).toHaveLength(1)
    await click(byLabel('Remind me at Uptown'))
    expect('off' in mocks.saved.at(-1).gyms.find(g => g.id === 'b')).toBe(false)
  })

  it('⋯ menu: rename in a small sheet', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    await click(byLabel('More for Downtown'))
    expect(mocks.menu.items.map(i => i.label)).toEqual(['Rename', 'Move it on the map', 'Remove'])
    act(() => { mocks.menu.items[0].onClick() })
    // the sheet, drawn into its own root
    const sheetHost = document.createElement('div'); document.body.appendChild(sheetHost)
    const sheetRoot = createRoot(sheetHost)
    const close = vi.fn()
    await act(async () => { sheetRoot.render(mocks.sheet(close)) })
    const input = sheetHost.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, '  Iron Temple  '); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { [...sheetHost.querySelectorAll('button')].find(b => b.textContent === 'Save').click() })
    await flush()
    expect(close).toHaveBeenCalled()
    expect(mocks.saved.at(-1).gyms.find(g => g.id === 'a').name).toBe('Iron Temple')
    act(() => sheetRoot.unmount()); sheetHost.remove()
  })

  it('⋯ menu: remove at once, with an Undo that puts it back in its place', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    await click(byLabel('More for Downtown'))
    await act(async () => { mocks.menu.items[2].onClick() })
    await flush()
    expect(mocks.saved.at(-1).gyms.map(g => g.id)).toEqual(['b'])
    const [msg, opts] = mocks.toast.mock.calls.at(-1)
    expect(msg).toContain('Downtown')
    expect(opts.action).toBe('Undo')
    await act(async () => { opts.onAction() })
    await flush()
    expect(mocks.saved.at(-1).gyms.map(g => g.id)).toEqual(['a', 'b'])
  })

  it('Add a gym, web map: straight to the editor', async () => {
    await render(<GymReminderPage />)
    await click(btn('Add a gym'))
    expect(mocks.pickCalls).toEqual([])
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { draft: {} } })
  })

  it('Add a gym, iPhone: Apple Maps first, its place lands in the editor; backing out stays put', async () => {
    mocks.native = true
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    mocks.picked = { name: 'Iron Temple', address: 'Gym St 1', lat: 47.1, lng: 8.2, radius: 120 }
    await render(<GymReminderPage />)
    await click(btn('Add a gym'))
    expect(mocks.pickCalls[0]).toMatchObject({ radius: 100, min: 50, max: 500, step: 10 })
    expect(mocks.pickCalls[0].strings.search).toBe('Find your gym…')
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { draft: mocks.picked } })
    mocks.nav.mockClear(); mocks.picked = null
    await click(btn('Add a gym'))
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('Add a gym, an iPhone build without the picker: the web map after all', async () => {
    mocks.native = true
    mocks.picked = undefined
    await render(<GymReminderPage />)
    await click(btn('Add a gym'))
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { draft: {} } })
  })

  it('the optional time window: 06:00 to 22:00 when switched on', async () => {
    await render(<GymReminderPage />)
    await click(switchIn('Only between certain hours'))
    expect(mocks.saved.at(-1).window).toEqual({ from: '06:00', to: '22:00' })
    expect(host.querySelectorAll('input[type="time"]')).toHaveLength(2)
  })

  it('background location refused: the row says so and leads to the settings', async () => {
    mocks.perm = { location: 'granted', background: 'denied', notifications: 'granted' }
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Only while using the app')
    expect(host.textContent).toContain('needs location access in the background')
  })
  it('Android, quick arrival check not allowed: says why and leads to the settings; allowed: just On', async () => {
    const { openAppSettings } = await import('../lib/gym-reminder.js')
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted', quick: 'off' }
    await render(<GymReminderPage />)
    expect(rowByText('Quick arrival check').textContent).toContain('Off')
    expect(host.textContent).toContain('up to half an hour')
    await click(rowByText('Quick arrival check'))
    expect(openAppSettings).toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    mocks.perm = { ...mocks.perm, quick: 'granted' }
    await render(<GymReminderPage />)
    expect(rowByText('Quick arrival check').textContent).toContain('On')
    expect(host.textContent).toContain('a few minutes at most')
  })
  it('iOS (no quick flag): no such row', async () => {
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    await render(<GymReminderPage />)
    expect(host.textContent).not.toContain('Quick arrival check')
  })
})

describe('one gym', () => {
  it('a new gym from a draft: default radius, saved with the place', async () => {
    mocks.location = { state: { draft: { lat: 47.3769, lng: 8.5417 } } }
    await render(<GymEditPage />)
    expect(host.textContent).toContain('100 m')
    expect(host.querySelector('.gym-map')).toBeTruthy()
    // where a search goes, right under the field
    expect(host.textContent).toContain('Searches go to OpenStreetMap. Your gyms stay on this phone.')
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    await click(save)
    expect(mocks.saved.at(-1).gyms).toHaveLength(1)
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ lat: 47.3769, lng: 8.5417, radius: 100 })
  })

  it('without a place, Save waits for the pin', async () => {
    mocks.location = { state: { draft: {} } }
    await render(<GymEditPage />)
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    expect(save.disabled).toBe(true)
  })
})

describe('one gym: search, here, Google Maps, Apple Maps', () => {
  const type = async (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const field = () => host.querySelector('.gmap-search input')
  const submit = async () => { await act(async () => { host.querySelector('.gmap-search').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush() }

  it('typing asks nobody; Enter searches, near the pin', async () => {
    mocks.location = { state: { draft: { lat: 47.3769, lng: 8.5417 } } }
    await render(<GymEditPage />)
    await type(field(), 'Iron')
    await type(field(), 'Iron Temple')
    await flush()
    expect(mocks.searches).toEqual([])
    await submit()
    expect(mocks.searches).toEqual([['Iron Temple', { near: { lat: 47.3769, lng: 8.5417 } }]])
  })

  it('a result is a card; picking it moves the pin and names the gym', async () => {
    mocks.location = { state: { draft: {} } }
    mocks.hits = [
      { id: '1', name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2, fitness: true },
      { id: '2', name: 'Gym Street', address: 'Zürich', lat: 47.2, lng: 8.3, fitness: false },
    ]
    await render(<GymEditPage />)
    await type(field(), 'iron temple')
    await submit()
    const cards = host.querySelectorAll('.gmap-hit')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Gym')
    expect(cards[0].textContent).toContain('Gym St 1, 8000 Zürich')
    await click(cards[0])
    expect(host.querySelectorAll('.gmap-hit')).toHaveLength(0)
    expect(host.querySelector('input[aria-label="Name"]').value).toBe('Iron Temple')
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2 })
  })

  it('a name you typed is kept when you pick a result', async () => {
    mocks.location = { state: { draft: {} } }
    mocks.hits = [{ id: '1', name: 'Iron Temple', address: '', lat: 47.1, lng: 8.2, fitness: true }]
    await render(<GymEditPage />)
    await type(host.querySelector('input[aria-label="Name"]'), 'Basement')
    await type(field(), 'iron')
    await submit()
    await click(host.querySelector('.gmap-hit'))
    expect(host.querySelector('input[aria-label="Name"]').value).toBe('Basement')
  })

  it('nothing found says so', async () => {
    mocks.location = { state: { draft: {} } }
    await render(<GymEditPage />)
    await type(field(), 'zzzz')
    await submit()
    expect(host.textContent).toContain('Nothing found. Try a street and a town.')
  })

  it('"I\'m here right now" puts the pin where the phone is', async () => {
    mocks.location = { state: { draft: {} } }
    await render(<GymEditPage />)
    expect(btn('Save').disabled).toBe(true)
    await click(btn('I’m here right now'))
    expect(mocks.asked).toEqual(['foreground'])
    expect(btn('Save').disabled).toBe(false)
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ lat: 47.3769, lng: 8.5417 })
  })

  it('Open in Google Maps: the current spot, no API key', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.location = { state: { draft: { lat: 47.3769, lng: 8.5417 } } }
    await render(<GymEditPage />)
    await click(btn('Open in Google Maps'))
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=47.376900%2C8.541700', '_blank', 'noopener')
    open.mockRestore()
  })

  it('iPhone: no web map, the place opens Apple Maps again; switched-off stays off on save', async () => {
    mocks.native = true
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    mocks.config = { on: true, gyms: [{ id: 'a', name: 'Downtown', address: 'Main St 1', lat: 47.37, lng: 8.54, radius: 150, text: '', off: true }], window: null }
    mocks.location = { state: { id: 'a' } }
    mocks.picked = { name: 'Elsewhere', address: 'Side St 2', lat: 47.5, lng: 8.6, radius: 200 }
    await render(<GymEditPage />)
    expect(host.querySelector('.gym-map')).toBe(null)
    await click(rowByText('Downtown'))
    expect(mocks.pickCalls[0]).toMatchObject({ lat: 47.37, lng: 8.54, radius: 150, name: 'Downtown' })
    expect(host.textContent).toContain('Side St 2')
    expect(host.textContent).toContain('200 m')
    await click(btn('Save'))
    // the name you gave it stays; the place and radius come from the map
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ id: 'a', name: 'Downtown', address: 'Side St 2', lat: 47.5, lng: 8.6, radius: 200, off: true })
  })

  it('iPhone build without the plugin: the web map takes over', async () => {
    mocks.native = true
    mocks.picked = undefined
    mocks.location = { state: { draft: { lat: 47.37, lng: 8.54 } } }
    await render(<GymEditPage />)
    expect(host.querySelector('.gym-map')).toBe(null)
    await click(rowByText('My gym'))
    expect(host.querySelector('.gym-map')).toBeTruthy()
  })
})
