// The animation packs on this device (store apps only): what is installed, what is downloading,
// and the person's choice of quality. The rules are lib/anim-quality.js; this is the state around
// them and the bridge to the native AnimationPacks plugin:
//
//   available()                              → { available }   iOS 26+ with Apple-hosted packs
//   status({ packId, probe })                → { state: 'ready'|'none', bytes?, downloadSize? }
//   download({ packId, wifiOnly, probe })    → resolves once installed; 'progress' events
//                                              { packId, fraction }; rejects with a code:
//                                              'needs-wifi', 'unavailable', 'cancelled', 'failed'
//   remove({ packId })
//   localPath({ packId, probe })             → { path } the folder the pack's <id>.webp sit in
//
// `probe` is one drawing the pack holds, for a native side that can only find a pack's folder
// through one of its files. iOS: ios/App/App/AnimationPacksPlugin.swift. Android answers
// "unavailable" until Play Asset Delivery comes (and the sideloaded APK never has packs).
//
// The choice is this device's, not the profile's: kept in localStorage, never in S, so it never
// syncs. Packs are downloaded per device, and a phone and an iPad want different sizes; the
// profile, its workouts and its history are not touched by any of this.
import { MOBILE } from './mobile.js'
import { EXIDX } from './exercises.js'
import { PACK_QUALITIES, FIGURES, packId, packDrawingId, readChoice, wantedPack, DEFAULT_CHOICE } from './anim-quality.js'

export const PREFS_KEY = 'gym_anim_v1'
export const ALL_PACKS = PACK_QUALITIES.flatMap(px => FIGURES.map(f => packId(px, f)))
const PROBE_EX = '0001'
export const probeFor = id => packDrawingId(EXIDX[PROBE_EX], id.endsWith('-female') ? 'female' : 'male')

/* ---------------------------------------------------------------- the choice, per device */
export function readPrefs(storage = globalThis.localStorage) {
  let v = null
  try { v = JSON.parse(storage?.getItem(PREFS_KEY) || 'null') } catch { /* unreadable: the defaults */ }
  return { choice: readChoice(v?.choice ?? DEFAULT_CHOICE), wifiOnly: v?.wifiOnly !== false }
}
export function writePrefs(patch, storage = globalThis.localStorage) {
  const next = { ...readPrefs(storage), ...patch }
  next.choice = readChoice(next.choice)
  next.wifiOnly = next.wifiOnly !== false
  try { storage?.setItem(PREFS_KEY, JSON.stringify(next)) } catch { /* private mode: for this run only */ }
  state = { ...state, prefs: next }
  emit()
  return next
}

/** The screen's short side in CSS px: what Auto reads to tell a phone from a tablet. */
export const deviceInfo = () => {
  try { return { shortSide: Math.min(window.screen?.width || 0, window.screen?.height || 0) } } catch { return {} }
}

/* ---------------------------------------------------------------- state */
// packs: { [packId]: { state: 'none'|'ready'|'downloading'|'failed'|'needs-wifi', progress, bytes, base, dir } }
// (`dir`: the pack's folder as the native side names it, for the Apple Watch's clips, lib/watch-sync.js)
let state = { available: false, checked: false, packs: {}, prefs: readPrefs() }
const listeners = new Set()
const emit = () => { for (const fn of listeners) fn() }
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
export const getState = () => state
const setPack = (id, patch) => { state = { ...state, packs: { ...state.packs, [id]: { ...(state.packs[id] || {}), ...patch } } }; emit() }

/** The installed packs as clipSources wants them: pack id → base its files are read from. */
export const installedBases = (s = state) =>
  Object.fromEntries(Object.entries(s.packs).filter(([, p]) => p.state === 'ready' && p.base).map(([id, p]) => [id, p.base]))

/* ---------------------------------------------------------------- the native side */
// Registered once and handed out inside an object: a Capacitor plugin proxy answers `then` with
// a native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const packsPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin, Capacitor } = await import('@capacitor/core')
  return { Packs: registerPlugin('AnimationPacks'), toUrl: p => Capacitor.convertFileSrc(p) }
})().catch(() => null))

async function readPack(p, id) {
  try {
    const st = await p.Packs.status({ packId: id, probe: probeFor(id) })
    if (st?.state !== 'ready') { setPack(id, { state: state.packs[id]?.state === 'downloading' ? 'downloading' : 'none', bytes: 0, base: null }); return }
    const { path } = await p.Packs.localPath({ packId: id, probe: probeFor(id) })
    setPack(id, { state: 'ready', bytes: Number(st.bytes) || 0, base: path ? p.toUrl(path) : null, dir: path || null, progress: 1 })
  } catch { setPack(id, { state: 'none', base: null }) }
}

/** Asks the native side what it has. Once at start, and after every download or removal. */
export async function refresh() {
  const p = await packsPlugin()
  if (!p) { state = { ...state, checked: true, available: false }; emit(); return state }
  let available = false
  try { available = !!(await p.Packs.available())?.available } catch { available = false }
  state = { ...state, checked: true, available }
  emit()
  if (available) await Promise.all(ALL_PACKS.map(id => readPack(p, id)))
  return state
}

let progressHooked = false
const downloads = new Map()
/** Downloads a pack; resolves to 'ready' or the code it stopped with. One at a time per pack. */
export function download(id) {
  if (downloads.has(id)) return downloads.get(id)
  const run = (async () => {
    const p = await packsPlugin()
    if (!p || !state.available) return 'unavailable'
    if (!progressHooked) {
      progressHooked = true
      // Returned into the catch: addListener rejects when the plugin is not behind the bridge.
      Promise.resolve(p.Packs.addListener('progress', e => {
        if (e?.packId && state.packs[e.packId]?.state === 'downloading') setPack(e.packId, { progress: Math.max(0, Math.min(1, Number(e.fraction) || 0)) })
      })).catch(() => {})
    }
    setPack(id, { state: 'downloading', progress: 0 })
    try {
      await p.Packs.download({ packId: id, wifiOnly: state.prefs.wifiOnly, probe: probeFor(id) })
      await readPack(p, id)
      return state.packs[id]?.state === 'ready' ? 'ready' : 'failed'
    } catch (e) {
      const code = ['needs-wifi', 'unavailable', 'cancelled'].includes(e?.code) ? e.code : 'failed'
      setPack(id, { state: code === 'needs-wifi' ? 'needs-wifi' : code === 'cancelled' ? 'none' : 'failed' })
      return code
    }
  })().finally(() => downloads.delete(id))
  downloads.set(id, run)
  return run
}

export async function remove(id) {
  const p = await packsPlugin()
  if (!p) return false
  try { await p.Packs.remove({ packId: id }) } catch { /* read back below either way */ }
  await readPack(p, id)
  return state.packs[id]?.state !== 'ready'
}

/**
 * Starts the download the current choice and figure want, when the pack is not there yet and
 * not on its way. Called when the choice or the figure changes and at start. Never touches the
 * profile: the figure is only read.
 */
export function ensureWanted(figure, device = deviceInfo()) {
  if (!state.available) return null
  const id = wantedPack(state.prefs.choice, figure, device)
  if (!id) return null
  const st = state.packs[id]?.state
  if (st === 'ready' || st === 'downloading') return null
  return download(id)
}

export function _resetAnimPacks(next = {}) {
  pluginP = null; progressHooked = false; downloads.clear()
  state = { available: false, checked: false, packs: {}, prefs: readPrefs(), ...next }
}
