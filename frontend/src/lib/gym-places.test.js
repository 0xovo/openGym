// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The gym map's places (1.4.4): the Nominatim search with its manners (one a second, cached, no
// repeats in flight, an honest User-Agent), the ranking that puts gyms first, the Google Maps link
// and the iPhone's Apple Maps picker with its fallback for builds that do not have it.
const cap = vi.hoisted(() => ({ platform: 'ios', available: true, pick: null }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => cap.platform, isPluginAvailable: () => cap.available },
  registerPlugin: () => ({ pick: o => cap.pick(o) }),
}))

import {
  createPlaceSearch, placeOf, rankPlaces, isFitness, googleMapsUrl, pickOnNativeMap, hasNativePicker,
  accentHex, MIN_GAP_MS, _resetGymPlaces,
} from './gym-places.js'

const row = (o = {}) => ({ place_id: 1, lat: '47.1', lon: '8.2', name: 'Iron Temple', display_name: 'Iron Temple, Gym St 1, Zürich, Switzerland', category: 'leisure', type: 'fitness_centre', address: { road: 'Gym St', house_number: '1', postcode: '8000', city: 'Zürich' }, ...o })
const okJson = rows => ({ ok: true, json: async () => rows })

describe('a Nominatim row', () => {
  it('becomes a name, a short address and the place', () => {
    expect(placeOf(row())).toEqual({ id: '1', name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2, fitness: true })
  })
  it('without a name or an address breakdown: read from the display name', () => {
    const p = placeOf(row({ name: '', address: undefined, category: 'place', type: 'house', display_name: 'Bahnhofstrasse 5, Zürich, Switzerland' }))
    expect(p).toMatchObject({ name: 'Bahnhofstrasse 5', address: 'Zürich, Switzerland', fitness: false })
  })
  it('no usable place: dropped', () => {
    expect(placeOf(row({ lat: 'x' }))).toBe(null)
  })
  it('what counts as a gym', () => {
    expect(isFitness({ category: 'leisure', type: 'fitness_centre' })).toBe(true)
    expect(isFitness({ category: 'leisure', type: 'sports_centre' })).toBe(true)
    expect(isFitness({ category: 'highway', type: 'residential' })).toBe(false)
  })
  it('gyms first, then the nearest', () => {
    const near = { lat: 47, lng: 8 }
    const far = { id: 'far', lat: 48, lng: 8, fitness: false }
    const close = { id: 'close', lat: 47.01, lng: 8, fitness: false }
    const gym = { id: 'gym', lat: 47.5, lng: 8, fitness: true }
    expect(rankPlaces([far, close, gym], near).map(p => p.id)).toEqual(['gym', 'close', 'far'])
    // no centre yet: Nominatim's own order after the gyms
    expect(rankPlaces([far, close, gym], null).map(p => p.id)).toEqual(['gym', 'far', 'close'])
  })
})

describe('the search', () => {
  let clock, sleeps, fetcher, search
  beforeEach(() => {
    clock = 1_000_000
    sleeps = []
    fetcher = vi.fn(async () => okJson([row()]))
    search = createPlaceSearch({ fetcher, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms }, lang: () => 'de' })
  })

  it('names the app in the User-Agent, asks in the app\'s language, biased to the map', async () => {
    const r = await search('  Iron   Temple ', { near: { lat: 47.37, lng: 8.54 } })
    expect(r[0].name).toBe('Iron Temple')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2&addressdetails=1&limit=8&q=Iron%20Temple&accept-language=de/)
    expect(url).toContain('&viewbox=8.3400,47.5700,8.7400,47.1700')
    expect(url).not.toContain('bounded=1')
    expect(init.headers['User-Agent']).toMatch(/^openGym\/.+opengym\.ch/)
  })
  it('an empty question asks nobody', async () => {
    expect(await search('   ')).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('at most one request a second: the second question waits its turn', async () => {
    await search('one')
    clock += 200
    await search('two')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([MIN_GAP_MS - 200])
    // a while later: no wait
    clock += 5000
    await search('three')
    expect(sleeps).toHaveLength(1)
  })
  it('the same question again is answered from memory (case and spaces aside)', async () => {
    await search('Iron Temple')
    await search('iron  temple')
    expect(fetcher).toHaveBeenCalledTimes(1)
    // somewhere else on the map is a new question
    await search('iron temple', { near: { lat: 40, lng: -3 } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('a double tap on Search sends one request', async () => {
    const [a, b] = await Promise.all([search('gym'), search('gym')])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })
  it('a failed answer throws and is not cached', async () => {
    fetcher.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(search('gym')).rejects.toThrow('429')
    await search('gym')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('Google Maps and the accent', () => {
  it('a plain maps link, no key', () => {
    expect(googleMapsUrl({ lat: 47.3769, lng: 8.5417 })).toBe('https://www.google.com/maps/search/?api=1&query=47.376900%2C8.541700')
  })
  it('the accent as #rrggbb for the native tint', () => {
    document.documentElement.style.setProperty('--acc', '#30d158')
    expect(accentHex()).toBe('#30d158')
    document.documentElement.style.setProperty('--acc', 'rgb(10, 132, 255)')
    expect(accentHex()).toBe('#0a84ff')
    document.documentElement.style.removeProperty('--acc')
  })
})

describe('the iPhone picker', () => {
  beforeEach(() => { _resetGymPlaces(); cap.platform = 'ios'; cap.available = true })

  it('returns the place Apple Maps gave', async () => {
    cap.pick = async o => ({ name: 'Iron Temple', address: 'Gym St 1', lat: 47.1, lng: 8.2, radius: o.radius + 20 })
    expect(await hasNativePicker()).toBe(true)
    expect(await pickOnNativeMap({ radius: 100 })).toEqual({ name: 'Iron Temple', address: 'Gym St 1', lat: 47.1, lng: 8.2, radius: 120 })
  })
  it('backed out: null', async () => {
    cap.pick = async () => ({ cancelled: true })
    expect(await pickOnNativeMap({})).toBe(null)
  })
  it('an older build without the plugin: undefined, so the web map shows', async () => {
    cap.available = false
    expect(await hasNativePicker()).toBe(false)
    expect(await pickOnNativeMap({})).toBe(undefined)
  })
  it('registered but not answering as a plugin (UNIMPLEMENTED): the web map from then on', async () => {
    cap.pick = async () => { const e = new Error('"GymMapPicker" plugin is not implemented on ios'); e.code = 'UNIMPLEMENTED'; throw e }
    expect(await pickOnNativeMap({})).toBe(undefined)
    expect(await hasNativePicker()).toBe(false)
  })
  it('Android: never the native picker', async () => {
    cap.platform = 'android'
    expect(await pickOnNativeMap({})).toBe(undefined)
  })
})
