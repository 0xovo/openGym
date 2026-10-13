// Settings → Apple Watch (iPhone app only): this phone's choices for its watch, and what the watch
// last said about itself. Per device, in localStorage, never in the profile: a profile signed in on
// two phones may have one watch, or none. The watch gets the choices with every snapshot
// (lib/watch-sync.js, `settings`); it reports back with a watchStatus event.
//
//   enabled      send workouts to the watch at all (off: the watch shows nothing to do)
//   health       Apple Health on the watch: workout session, live heart rate, saved workouts
//   restHaptics  the wrist taps when a rest is over
//   crown        what the Digital Crown turns first on a set: 'reps' or 'weight'
export const WATCH_PREFS_KEY = 'gym_watch_v1'
export const WATCH_STATUS_KEY = 'gym_watch_status_v1'
export const WATCH_DEFAULTS = Object.freeze({ enabled: true, health: false, restHaptics: true, crown: 'reps' })

const listeners = new Set()
export const onWatchPrefs = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's problem */ } } }

const read = (key, storage) => { try { return JSON.parse(storage?.getItem(key) || 'null') } catch { return null } }

export function readWatchPrefs(storage = globalThis.localStorage) {
  const v = read(WATCH_PREFS_KEY, storage) || {}
  return {
    enabled: v.enabled !== false,
    health: v.health === true,
    restHaptics: v.restHaptics !== false,
    crown: v.crown === 'weight' ? 'weight' : 'reps',
  }
}

export function writeWatchPrefs(patch, storage = globalThis.localStorage) {
  const next = readWatchPrefs({ getItem: () => JSON.stringify({ ...readWatchPrefs(storage), ...patch }) })
  try { storage?.setItem(WATCH_PREFS_KEY, JSON.stringify(next)) } catch { /* private mode: for this run */ }
  emit()
  return next
}

/** What the watch said last: { health: 'on'|'off'|'denied', version, at } or null. */
export function readWatchStatus(storage = globalThis.localStorage) {
  const v = read(WATCH_STATUS_KEY, storage)
  return v && typeof v === 'object' ? v : null
}

export function writeWatchStatus(ev, storage = globalThis.localStorage) {
  const health = ['on', 'off', 'denied'].includes(ev?.health) ? ev.health : null
  const next = { health, version: typeof ev?.version === 'string' ? ev.version.slice(0, 20) : null, at: Number(ev?.at) || Date.now() }
  try { storage?.setItem(WATCH_STATUS_KEY, JSON.stringify(next)) } catch { /* shown again next time */ }
  emit()
  return next
}

/** The choices as the watch reads them (WatchCore Model.swift WatchSettings). */
export const settingsForWatch = (p = readWatchPrefs()) => ({ health: p.health, restHaptics: p.restHaptics, crown: p.crown })
