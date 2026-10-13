// The Apple Watch link, the page's side (native: ios/App/App/WatchBridgePlugin.swift, the watch
// app: ios/App/Watch).
//
// Phone → watch: while a workout runs, a snapshot of it (each exercise by name, its sets with
// weight, reps and done, the rest, where you are) goes to the watch whenever it changes. The watch
// then runs the session on its own: the phone's page sleeps once the phone is locked in a pocket.
//
// Watch → phone: what happened on the watch comes back as small events ({ id, type: 'setDone',
// wid, exId, entryIdx, setIdx, w, r, at }). They are applied through the workout screen's own
// actions (bindWatchActions), the same ones a tap on the phone runs (rest timer, the high-water
// mark, the end-of-workout sheet), never a second copy of them. Each event is applied once, by its
// id, and only then acknowledged, which takes it out of the native queue; until the workout screen
// is there to apply it, it waits in that queue.
//
// The iPhone app only. Without a paired watch with the app on it, nothing is sent and nothing
// arrives: the phone behaves exactly as before.
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX } from './exercises.js'
import { exerciseNameFor } from './i18n.js'
import { modeOf, setLabel, lastEntryFor } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { sessionHistory } from './backfill.js'

export const SNAPSHOT_VERSION = 1
const APPLIED_KEY = 'gym_watch_applied'
const APPLIED_MAX = 300
const SEND_DEBOUNCE_MS = 400

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ---------- the snapshot ---------- */

/** What the watch needs to run the session: plain data, no media (licence: text only). */
export function buildSnapshot(S, { timer = null } = {}) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries)) return { v: SNAPSHOT_VERSION, active: null }
  let H = null
  try { H = sessionHistory(S) } catch { H = null }
  return {
    v: SNAPSHOT_VERSION,
    active: {
      id: A.id || null,
      name: A.name || '',
      unit: S.unit === 'lb' ? 'lb' : 'kg',
      cur: Math.max(0, Math.min(A.entries.length - 1, A.cur || 0)),
      restSec: num(S.restSec) || 0,
      // a rest running on the phone, so the watch counts down the same one
      rest: timer && !timer.paused && !timer.ready && num(timer.endsAt) ? { endsAt: timer.endsAt } : null,
      entries: A.entries.map(e => {
        const ex = EXIDX[e.id]
        const target = e.target || {}
        const mode = modeOf({ ...target, id: e.id })
        let last = null
        try {
          const l = H ? lastEntryFor(H, e.id, e.rid) : null
          if (l && Array.isArray(l.sets) && l.sets.length) last = l.sets.map(s => setLabel(e.id, s, l.target)).join(', ')
        } catch { last = null }
        return {
          id: e.id,
          name: ex ? exerciseNameFor(ex) : String(target.name || e.name || e.id),
          mode,
          restSec: num(target.restSec),
          last,
          sets: (e.sets || []).map(s => ({
            w: num(s.w), r: num(s.r), sec: num(s.sec), done: !!s.done, warmup: !!isWarmupRow(s),
          })),
        }
      }),
    },
  }
}

/* ---------- applying the watch's events ---------- */

let handlers = null
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

/** The entry an event means: by position when it still holds that exercise, else by the exercise. */
function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && A.entries[ev.entryIdx].id === ev.exId) return ev.entryIdx
  return A.entries.findIndex(e => e.id === ev.exId)
}

/**
 * Applies the events not applied yet, in order, through the bound actions. Returns the ids that
 * are done with: applied now, applied before, or about a workout that is not running any more.
 * Without bound actions (the workout screen is not there) nothing is done with and all stay queued.
 */
export function applyEvents (events, getState) {
  if (!handlers || !Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const A = getState()?.S?.active
    if (ev.type === 'setDone' && A && Array.isArray(A.entries) && (!ev.wid || ev.wid === A.id)) {
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set) handlers.setDone(idx, ev.setIdx, { w: num(ev.w), r: num(ev.r) })
    }
    // Applied, or meaningless now (another workout, a set that is gone): either way it is done.
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then`, so a promise must never resolve with
// the bare proxy (lib/rest-alert.js, the Coach hang #42).
const watchPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || (await nativePlatform()) !== 'ios') return null
  const { registerPlugin } = await import('@capacitor/core')
  return { WatchBridge: registerPlugin('WatchBridge') }
})().catch(() => null))

let getStateRef = null
let draining = null

/** Takes what the watch sent from the native queue, applies it, and acknowledges what is done. */
export function drainWatchEvents () {
  if (draining) return draining
  draining = (async () => {
    try {
      const p = await watchPlugin()
      if (!p || !getStateRef) return []
      const { events = [] } = (await p.WatchBridge.drain()) || {}
      const done = applyEvents(events, getStateRef)
      if (done.length) await p.WatchBridge.ack({ ids: done })
      return done
    } catch { return [] } finally { draining = null }
  })()
  return draining
}

/** The workout screen hands over its own actions while it is mounted. Returns the unbind. */
export function bindWatchActions (h) {
  handlers = h
  drainWatchEvents()
  return () => { if (handlers === h) handlers = null }
}

/**
 * Started once by the app. Sends a snapshot whenever the workout or its rest changes (debounced,
 * and only what differs from the last one sent), drains the queue when the app comes back.
 */
export async function startWatchSync ({ useStore, useUI }) {
  const p = await watchPlugin()
  if (!p) return () => {}
  getStateRef = () => useStore.getState()
  let lastSent = null, tm = null
  const send = async () => {
    tm = null
    try {
      const st = await p.WatchBridge.status()
      if (!st || !st.paired || !st.installed) return
      const json = JSON.stringify(buildSnapshot(useStore.getState().S, { timer: useUI.getState().timer }))
      if (json === lastSent) return
      const r = await p.WatchBridge.sendSnapshot({ json })
      if (r && r.sent) lastSent = json
    } catch { /* no watch, or not now: the next change tries again */ }
  }
  const schedule = () => { clearTimeout(tm); tm = setTimeout(send, SEND_DEBOUNCE_MS) }
  const offStore = useStore.subscribe((s, prev) => { if (s.S.active !== prev.S.active || s.S.unit !== prev.S.unit) schedule() })
  const offUI = useUI.subscribe((s, prev) => { if (s.timer !== prev.timer) schedule() })
  const sub = await p.WatchBridge.addListener('watchEvent', () => { drainWatchEvents() })
  const onVisible = () => { if (document.visibilityState === 'visible') { drainWatchEvents(); schedule() } }
  document.addEventListener('visibilitychange', onVisible)
  schedule()
  drainWatchEvents()
  return () => { offStore(); offUI(); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

// Test seams.
export function _setWatchPluginForTest (plugin, getState) { pluginP = Promise.resolve(plugin ? { WatchBridge: plugin } : null); getStateRef = getState || null }
export function _resetWatchSync () { handlers = null; pluginP = null; getStateRef = null; draining = null }
