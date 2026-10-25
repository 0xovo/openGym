// Finding a gym on a map (#614, the 1.4.4 picker): the place search, the map tiles, the native
// Apple Maps picker on the iPhone and the "Open in Google Maps" link.
//
// Where a search goes: on the iPhone to Apple (MapKit's local search, inside the native picker,
// ios/App/App/GymMapPickerPlugin.swift); in the Android app and as the iPhone's fallback to
// OpenStreetMap's Nominatim. Only the text typed and the map's rough area go out, never the gyms.
//
// Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim): at most one request
// a second, an identifying User-Agent, results cached, and no search-as-you-type. So a search runs
// on Enter or the Search button only, the same question twice is answered from memory (this
// session only, nothing is stored), a second one within a second waits its turn, and a question
// already on its way is not asked again.
//
// Tiles: OpenStreetMap's standard tiles (tile usage policy: attribution shown, no bulk download,
// the app's own requests only). Dark mode darkens them on the phone (a CSS filter, index.css
// .gym-map), so no second tile provider and no API key: CARTO's dark basemaps now need a key.
import { MOBILE } from './mobile.js'
import { getLang } from './i18n.js'
import { nativeFetch } from './capacitor-fetch.js'

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
export const USER_AGENT = 'openGym/' + (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev') + ' (gym reminder; +https://opengym.ch)'
export const TILES = Object.freeze({
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
})
export const MIN_GAP_MS = 1000

// In the phone app the request goes out natively (CapacitorHttp), with the User-Agent above. A
// plain browser may not set one: there it would only cost a CORS preflight Nominatim refuses, and
// the page's Referer names the app instead, which is what the policy asks of browser apps.
async function placeFetch(url, init) {
  let native = false
  try { native = (await import('@capacitor/core')).Capacitor.isNativePlatform() } catch { /* no Capacitor */ }
  if (native) return nativeFetch(url, init)
  const { 'User-Agent': _ua, ...headers } = init.headers || {}
  return fetch(url, { ...init, headers, referrerPolicy: 'strict-origin-when-cross-origin' })
}
const CACHE_MAX = 40

// What Nominatim calls a gym. These come first in the results, the rest after them by distance.
const FITNESS = new Set(['fitness_centre', 'sports_centre', 'fitness_station', 'gym', 'sports_hall', 'climbing', 'swimming_pool', 'dojo'])
export const isFitness = r => FITNESS.has(String(r?.type || '')) && /^(leisure|amenity|sport|building)$/.test(String(r?.category || r?.class || ''))

const km = (a, b) => {
  const rad = x => x * Math.PI / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** One Nominatim row as the picker shows it: a name, a short address, the place. Null if unusable. */
export function placeOf(r) {
  const lat = Number(r?.lat), lng = Number(r?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const a = r.address || {}
  const full = String(r.display_name || '')
  const street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ')
  const town = [a.postcode, a.city || a.town || a.village || a.suburb || a.municipality].filter(Boolean).join(' ')
  const name = String(r.name || '').trim() || full.split(',')[0].trim()
  let address = [street, town].filter(Boolean).join(', ')
  if (!address) address = full.split(',').slice(name ? 1 : 0, 4).map(s => s.trim()).filter(Boolean).join(', ')
  return { id: String(r.place_id ?? lat + ',' + lng), name, address, lat, lng, fitness: isFitness(r) }
}

/** Gyms first, then the nearest (when the map has a centre), else in Nominatim's own order. */
export function rankPlaces(places, near) {
  const d = p => (near ? km(near, p) : 0)
  return places.map((p, i) => ({ p, i, d: d(p) }))
    .sort((x, y) => (y.p.fitness - x.p.fitness) || (x.d - y.d) || (x.i - y.i))
    .map(x => x.p)
}

/**
 * A place search with Nominatim's manners built in. `fetcher`, `now` and `sleep` are for tests.
 * search(q, { near }) resolves to ranked places ([] for an empty question).
 */
export function createPlaceSearch({ fetcher = placeFetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), lang = () => getLang() || 'en' } = {}) {
  const cache = new Map()
  const flying = new Map()
  let nextAt = 0
  const ask = async (query, near, key) => {
    // One a second, in the order asked: a second question waits for the slot after the first.
    const at = Math.max(now(), nextAt)
    nextAt = at + MIN_GAP_MS
    if (at > now()) await sleep(at - now())
    let url = NOMINATIM + '?format=jsonv2&addressdetails=1&limit=8&q=' + encodeURIComponent(query) + '&accept-language=' + encodeURIComponent(lang())
    // Biased to what is on the map, not bounded to it: a gym in the next town still shows.
    if (near) url += '&viewbox=' + [near.lng - 0.2, near.lat + 0.2, near.lng + 0.2, near.lat - 0.2].map(n => n.toFixed(4)).join(',')
    const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
    if (!res.ok) throw new Error('search failed: ' + res.status)
    const rows = await res.json()
    const out = rankPlaces((Array.isArray(rows) ? rows : []).map(placeOf).filter(Boolean), near)
    cache.set(key, out)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
    return out
  }
  return function search(q, { near = null } = {}) {
    const query = String(q || '').trim().replace(/\s+/g, ' ')
    if (!query) return Promise.resolve([])
    // About 10 km of map is "the same place" for a repeated question.
    const area = near ? near.lat.toFixed(1) + ',' + near.lng.toFixed(1) : ''
    const key = query.toLowerCase() + '|' + lang() + '|' + area
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (flying.has(key)) return flying.get(key)
    const p = ask(query, near, key).finally(() => flying.delete(key))
    flying.set(key, p)
    return p
  }
}

export const searchPlaces = createPlaceSearch()

/** A link that shows the spot in Google Maps: the app on a phone that has it, the website otherwise. */
export const googleMapsUrl = ({ lat, lng }) =>
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat.toFixed(6) + ',' + lng.toFixed(6))

/* ---------------- the iPhone's own map ---------------- */

// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with a
// native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pickerP = null
const mapPicker = () => pickerP || (pickerP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  if (typeof Capacitor.isPluginAvailable === 'function' && !Capacitor.isPluginAvailable('GymMapPicker')) return null
  return { GymMapPicker: registerPlugin('GymMapPicker') }
})().catch(() => null))

/** Whether this phone picks gyms on Apple Maps (an iPhone build with the plugin). */
export async function hasNativePicker() { return !!(await mapPicker()) }

const UNIMPLEMENTED = e => e?.code === 'UNIMPLEMENTED' || /not implemented/i.test(String(e?.message || e))

/**
 * Opens the native Apple Maps picker. Resolves to { name, address, lat, lng, radius }, to null when
 * the person backed out, or to undefined when there is no native picker (an older build, Android,
 * the web): the caller then shows the web map instead.
 */
export async function pickOnNativeMap(opts = {}) {
  const p = await mapPicker()
  if (!p) return undefined
  try {
    const r = await p.GymMapPicker.pick(opts)
    if (!r || r.cancelled) return null
    const lat = Number(r.lat), lng = Number(r.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { name: String(r.name || ''), address: String(r.address || ''), lat, lng, radius: Number(r.radius) || opts.radius }
  } catch (e) {
    if (UNIMPLEMENTED(e)) { pickerP = Promise.resolve(null); return undefined }
    return null
  }
}

/** The accent colour as #rrggbb, for the native picker's tint (it cannot read CSS). */
export function accentHex(doc = globalThis.document) {
  try {
    const v = getComputedStyle(doc.documentElement).getPropertyValue('--acc').trim()
    if (/^#[0-9a-f]{6}$/i.test(v)) return v
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('')
    const m = /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v)
    if (m) return '#' + m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')
  } catch { /* no document */ }
  return ''
}

export function _resetGymPlaces() { pickerP = null }
