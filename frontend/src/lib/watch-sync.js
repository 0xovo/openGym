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
import { EXIDX, gifSrc, figureOf } from './exercises.js'
import { packId, packDrawingId } from './anim-quality.js'
import { getState as animPacks } from './anim-packs.js'
import { exerciseNameFor } from './i18n.js'
import { modeOf, setLabel, lastEntryFor, effectiveRoutineIds } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { sessionHistory } from './backfill.js'
import { buildCombinedEntries, deriveSessionName } from './session-merge.js'
import { todayISO } from './format.js'
import { sanitizeHr } from './heart-rate.js'
import { readWatchPrefs, settingsForWatch, writeWatchStatus, onWatchPrefs } from './watch-settings.js'

export const SNAPSHOT_VERSION = 1
const APPLIED_KEY = 'gym_watch_applied'
const APPLIED_MAX = 300
const SEND_DEBOUNCE_MS = 400
// Routines the watch can start besides today's: enough to choose from, small enough to send.
const READY_MAX = 8

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ---------- the snapshot ---------- */

// One exercise as the watch shows it.
function watchEntry (e, H) {
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
      // when it was ticked: of two ticks of the same set (phone and watch), the later wins
      ...(num(s.at) ? { at: num(s.at) } : {}),
    })),
  }
}

/**
 * What the watch can start by itself, the phone asleep: today's planned session and a few other
 * routines, each with its exercises built exactly as starting it on the phone builds them
 * (buildCombinedEntries, as sheets.jsx beginWorkout does).
 */
export function buildReady (S, today = todayISO()) {
  let H = null
  try { H = sessionHistory(S) } catch { H = null }
  const session = ids => {
    const { entries, routineIds, routines } = buildCombinedEntries(S, ids)
    if (!routines.length) return null
    return { routineIds, name: deriveSessionName(routines.map(r => r.name)) || '', entries: entries.map(e => watchEntry(e, H)) }
  }
  let todayIds = []
  try { todayIds = effectiveRoutineIds({ ...S, routines: S.routines || [], week: S.week || {}, dayPlan: S.dayPlan || {} }, today, today) || [] } catch { todayIds = [] }
  const planned = todayIds.length ? session(todayIds) : null
  const others = (S.routines || []).filter(r => r && !todayIds.includes(r.id)).slice(0, READY_MAX).map(r => session([r.id])).filter(Boolean)
  return { today: planned, others }
}

/** What the watch needs to run the session: plain data, no media (licence: text only). */
export function buildSnapshot(S, { timer = null, ready = null } = {}) {
  const A = S && S.active
  const unit = S && S.unit === 'lb' ? 'lb' : 'kg'
  const restSec = num(S && S.restSec) || 0
  if (!A || !Array.isArray(A.entries)) return { v: SNAPSHOT_VERSION, unit, restSec, active: null, ready }
  let H = null
  try { H = sessionHistory(S) } catch { H = null }
  return {
    v: SNAPSHOT_VERSION,
    unit,
    restSec,
    ready,
    active: {
      id: A.id || null,
      name: A.name || '',
      unit,
      cur: Math.max(0, Math.min(A.entries.length - 1, A.cur || 0)),
      restSec: num(S.restSec) || 0,
      // a rest running on the phone, so the watch counts down the same one
      rest: timer && !timer.paused && !timer.ready && num(timer.endsAt) ? { endsAt: timer.endsAt } : null,
      entries: A.entries.map(e => watchEntry(e, H)),
    },
  }
}

/**
 * The running workout's animations for the watch, from what this phone itself shows for each
 * exercise: the smallest downloaded animation pack of the figure (240 px, `packId` + `drawing`, read
 * through Background Assets on the phone) when there is one, else the app's built-in clip (`path` inside the app package:
 * the 180 px animated WebP of the store build, an MP4 loop in other builds). The native side makes
 * each into a small GIF and sends it as a file; the watch deletes them when the workout ends.
 * Nothing is ever fetched from anywhere.
 */
export const WATCH_PACK_PX = 240
export function clipsFor (S, packs = animPacks().packs || {}) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries)) return []
  const figure = figureOf(S)
  const pid = packId(WATCH_PACK_PX, figure)
  const pack = packs[pid] && packs[pid].state === 'ready' ? pid : null
  const out = [], seen = new Set()
  for (const e of A.entries) {
    const ex = e && EXIDX[e.id]
    if (!ex || seen.has(e.id) || !ex.gif) continue
    seen.add(e.id)
    const drawing = packDrawingId(ex, figure)
    // a pack's files are read through Background Assets on the phone, never by a path
    if (pack && drawing && /^[A-Za-z0-9_-]+$/.test(drawing)) { out.push({ exId: e.id, packId: pack, drawing }); continue }
    const path = gifSrc(ex, figure)
    if (!/\.(webp|mp4|gif)$/i.test(path) || /^[a-z]+:|^\//i.test(path) || path.includes('..')) continue
    out.push({ exId: e.id, path })
  }
  return out
}

/* ---------- applying the watch's events ---------- */

let handlers = null      // the workout screen's: setDone, finish
let appHandlers = null   // the app's: start
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

/** The entry an event means: by position when it still holds that exercise, else by the exercise. */
function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && A.entries[ev.entryIdx].id === ev.exId) return ev.entryIdx
  return A.entries.findIndex(e => e.id === ev.exId)
}

/**
 * Applies the events not applied yet, in order. Returns the ids that are done with: applied now,
 * applied before, or about a workout that is not running any more. An event whose actions are not
 * there yet (a set before the workout screen is open) stops the run: it and everything after it
 * stay queued, in order, for the next drain.
 *
 *   start   { routineIds, wid, at }  the app starts that session with the watch's id and start
 *   setDone { wid, exId, entryIdx, setIdx, w, r, at }   the workout screen's own tick
 *   finish  { wid, at }              the workout screen's own Finish and save
 *   setHr   { wid, exId, entryIdx, setIdx, hr?, restHr? }   heart rate on a set (lib/heart-rate.js)
 *
 * A tick for a workout already saved (finished on the phone while the watch was away) is written
 * into that saved workout, stamped so the next sync keeps it. A tick while the workout screen is
 * not open opens it (appHandlers.openWorkout), and the queue drains once it is there. Of two
 * changes of the same set, the later one (`at`) wins.
 */
export function applyEvents (events, getState) {
  if (!Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const S = getState()?.S
    const A = S?.active
    const ours = A && Array.isArray(A.entries) && (!ev.wid || ev.wid === A.id)
    // A workout finished on the phone while the watch was away: its later ticks still count.
    const saved = !ours && ev.wid && Array.isArray(S?.workouts) ? S.workouts.find(w => w && w.id === ev.wid) : null
    if (ev.type === 'start') {
      if (!A) {
        if (!appHandlers) break
        appHandlers.start(Array.isArray(ev.routineIds) ? ev.routineIds : [], { id: ev.wid || null, start: num(ev.at) })
      }
      // A workout already running on the phone is kept; one with the watch's id is this one.
    } else if (ev.type === 'setDone' && saved) {
      if (!appHandlers) break
      const fields = { done: true, ...(num(ev.w) != null ? { w: num(ev.w) } : {}), ...(num(ev.r) != null ? { r: num(ev.r) } : {}), ...(num(ev.at) ? { at: num(ev.at) } : {}) }
      const hr = sanitizeHr(ev.hr)
      if (hr) fields.hr = hr
      appHandlers.patchSet({ wid: ev.wid, exId: ev.exId, entryIdx: ev.entryIdx, setIdx: ev.setIdx }, fields, { ifNewer: num(ev.at) })
    } else if (ev.type === 'setDone' && ours) {
      if (!handlers) {
        // The tick is the workout screen's to apply: open it, and the queue drains when it binds.
        if (appHandlers?.openWorkout) appHandlers.openWorkout()
        break
      }
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set) handlers.setDone(idx, ev.setIdx, { w: num(ev.w), r: num(ev.r), at: num(ev.at), hr: sanitizeHr(ev.hr) })
    } else if (ev.type === 'watchStatus') {
      // What the watch says about itself, for Settings → Apple Watch. Never queued behind anything.
      writeWatchStatus(ev)
    } else if (ev.type === 'setHr') {
      // The rest's heart rate comes once the rest is over, maybe after the workout was saved:
      // a field on that set, wherever the set is now. Nothing for a reading that does not hold up.
      const fields = {}
      const hr = sanitizeHr(ev.hr), restHr = sanitizeHr(ev.restHr)
      if (hr) fields.hr = hr
      if (restHr) fields.restHr = restHr
      if (Object.keys(fields).length) {
        if (!appHandlers) break
        appHandlers.patchSet({ wid: ev.wid, exId: ev.exId, entryIdx: ev.entryIdx, setIdx: ev.setIdx }, fields)
      }
    } else if (ev.type === 'finish' && ours) {
      if (!handlers) {
        if (appHandlers?.openWorkout) appHandlers.openWorkout()
        break
      }
      handlers.finish()
    }
    // Applied, or meaningless now (another workout, a set that is gone): either way it is done.
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/** The app's own actions, for what needs no screen (starting a session, a set's heart rate). */
export function bindWatchAppActions (h) {
  appHandlers = h
  drainWatchEvents()
  return () => { if (appHandlers === h) appHandlers = null }
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
  let lastSent = null, lastClips = null, tm = null
  // The ready sessions only change with the plan, the log or the day: built again only then.
  let readyKey = null, ready = null
  const readyFor = S => {
    const key = [S.routines, S.week, S.dayPlan, S.workouts, S.exWeights, S.unit, todayISO()]
    if (!readyKey || key.some((v, i) => v !== readyKey[i])) {
      readyKey = key
      try { ready = buildReady(S) } catch { ready = null }
    }
    return ready
  }
  // Whether a watch with the app is there: asked at start and when the app comes back, not on every
  // change. Without one nothing below runs at all: no snapshot, no clips, no bridge call per tick.
  let linked = false
  const checkLink = async () => {
    try { const st = await p.WatchBridge.status(); linked = !!(st && st.paired && st.installed) } catch { linked = false }
    return linked
  }
  await checkLink()
  const send = async () => {
    tm = null
    if (!linked) return
    try {
      const S = useStore.getState().S
      const prefs = readWatchPrefs()
      // Settings → Apple Watch: off, the watch is told there is nothing (no workout, nothing ready).
      const snap = prefs.enabled
        ? buildSnapshot(S, { timer: useUI.getState().timer, ready: readyFor(S) })
        : { v: SNAPSHOT_VERSION, unit: S.unit === 'lb' ? 'lb' : 'kg', active: null, ready: null }
      snap.settings = settingsForWatch(prefs)
      const json = JSON.stringify(snap)
      if (json !== lastSent) {
        const r = await p.WatchBridge.sendSnapshot({ json })
        if (r && r.sent) lastSent = json
      }
      // The workout's animations, once per workout and exercise (the native side remembers).
      const clips = prefs.enabled ? clipsFor(S) : []
      const key = S.active ? S.active.id + '|' + clips.map(c => c.exId).join(',') : ''
      if (clips.length && key !== lastClips) {
        await p.WatchBridge.sendClips({ wid: S.active.id, clips })
        lastClips = key
      }
    } catch { /* no watch, or not now: the next change tries again */ }
  }
  const schedule = () => { if (!linked) return; clearTimeout(tm); tm = setTimeout(send, SEND_DEBOUNCE_MS) }
  const offStore = useStore.subscribe((s, prev) => { if (s.S !== prev.S) schedule() })
  // The rest as the watch needs it changes when it starts, stops or is paused, not every second.
  const restOf = t => (t ? `${t.endsAt}|${!!t.paused}|${!!t.ready}` : '')
  const offUI = useUI.subscribe((s, prev) => { if (s.timer !== prev.timer && restOf(s.timer) !== restOf(prev.timer)) schedule() })
  const offPrefs = onWatchPrefs(() => schedule())
  const sub = await p.WatchBridge.addListener('watchEvent', () => { drainWatchEvents() })
  const onVisible = () => { if (document.visibilityState === 'visible') { drainWatchEvents(); checkLink().then(() => schedule()) } }
  document.addEventListener('visibilitychange', onVisible)
  schedule()
  drainWatchEvents()
  return () => { offStore(); offUI(); offPrefs(); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

// Test seams.
export function _setWatchPluginForTest (plugin, getState) { pluginP = Promise.resolve(plugin ? { WatchBridge: plugin } : null); getStateRef = getState || null }
export function _resetWatchSync () { handlers = null; appHandlers = null; pluginP = null; getStateRef = null; draining = null }

/**
 * Writes `fields` (heart rate) onto one set: in the running session when it is that workout, else in
 * the saved workout of that id, which is then stamped as edited so the next sync keeps the change
 * (lib/sync-merge.js: of two copies of a workout the one edited last wins). Only these optional
 * fields are ever added; nothing is removed or renamed.
 */
export function patchSetIn (s, { wid, exId, entryIdx, setIdx }, fields, stamp, { ifNewer = null, recount = null } = {}) {
  const find = w => {
    if (!w || !Array.isArray(w.entries)) return null
    const i = w.entries[entryIdx] && w.entries[entryIdx].id === exId ? entryIdx : w.entries.findIndex(e => e && e.id === exId)
    return i >= 0 ? w.entries[i].sets?.[setIdx] || null : null
  }
  if (s.active && s.active.id === wid) {
    const set = find(s.active)
    if (set) Object.assign(set, fields)
    return !!set
  }
  const w = (s.workouts || []).find(x => x && x.id === wid)
  const set = find(w)
  if (!set) return false
  // Two changes of the same set: the later one wins (a tick from the watch older than an edit
  // made on the phone since keeps the phone's numbers; its heart rate still lands).
  let f = fields
  if (ifNewer != null && set.done && Number(set.at) > ifNewer) {
    f = {}
    if (fields.hr) f.hr = fields.hr
    if (fields.restHr) f.restHr = fields.restHr
    if (!Object.keys(f).length) return false
  }
  Object.assign(set, f)
  if (recount) recount(w)
  if (stamp) stamp(w)
  return true
}

/** Whether a watch is paired and has the app, for Settings → Apple Watch. */
export async function watchStatus () {
  const p = await watchPlugin()
  if (!p) return { paired: false, installed: false }
  try { const st = await p.WatchBridge.status(); return { paired: !!st?.paired, installed: !!st?.installed } } catch { return { paired: false, installed: false } }
}
