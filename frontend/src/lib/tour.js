// The app tour (components/Tour.jsx): coach marks on the real screens, offered once after the
// first setup and again from Settings → About & updates. This file is what the main bundle
// carries: the steps, the record of where this device stands with the tour, and a tiny store
// saying whether it is open. The overlay itself is its own chunk, fetched only when it opens.
//
// The record lives on this device only (localStorage), never in the synced state: a tour seen
// on the phone says nothing about the laptop. Nothing about it leaves the device.
import { useSyncExternalStore } from 'react'

const KEY = 'gym_tour_v1'

/* One stop each. `route`: the screen it is on. `anchor`: the data-tour="..." of the element it
   points at (null: a card in the middle, no spotlight). `tap`: tapping that element is a fine way
   on (it does what it does, then the tour moves). `practice`: shown on the sample session (useStore
   enterTourSandbox), which is thrown away the moment the tour leaves the workout. `when`: a stop
   that only makes sense for some profiles, decided once at the start (see tourSteps). `optional`:
   a stop whose element may still not be there (no rest timer after a Next instead of a tick) is
   passed over rather than shown pointing at nothing. */
export const STEPS = [
  { id: 'today', route: '/home', anchor: 'today' },
  { id: 'start', route: '/home', anchor: 'start' },
  { id: 'plan-mode', route: '/plan', anchor: 'plan-mode' },
  { id: 'plan-views', route: '/plan', anchor: 'plan-views' },
  { id: 'plan-body', route: '/plan', anchor: 'plan-body', when: c => c.plannedDays, optional: true },
  { id: 'plan-menu', route: '/plan', anchor: 'plan-menu' },
  { id: 'lib-search', route: '/library', anchor: 'lib-search' },
  { id: 'lib-filters', route: '/library', anchor: 'lib-filters' },
  { id: 'set', route: '/workout', anchor: 'set', practice: true },
  { id: 'tick', route: '/workout', anchor: 'tick', practice: true, tap: true },
  { id: 'rest', route: '/workout', anchor: 'rest', practice: true, when: c => c.rest, optional: true },
  { id: 'swipe', route: '/workout', anchor: 'swipe', practice: true, when: c => c.swipe, optional: true },
  { id: 'more', route: '/workout', anchor: 'workout-more', practice: true },
  { id: 'finish', route: '/workout', anchor: 'finish', practice: true },
  { id: 'stats', route: '/stats', anchor: 'stats-tiles' },
  { id: 'stats-body', route: '/stats', anchor: 'stats-body', when: c => c.balance, optional: true },
  { id: 'stats-records', route: '/stats', anchor: 'stats-records', when: c => c.workouts, optional: true },
  { id: 'look', route: '/settings', anchor: 'settings-look' },
  { id: 'units', route: '/settings', anchor: 'settings-units' },
  { id: 'data', route: '/settings', anchor: 'settings-data' },
  { id: 'done', route: '/home', anchor: null },
]

/** The stops for this profile, in order. `ctx`: { plannedDays, rest, swipe, balance, workouts }. */
export function tourSteps(ctx = {}) {
  return STEPS.filter(s => !s.when || s.when(ctx))
}

/** Where to go from `i` in direction `dir` (+1 / -1): the index, or -1 past either end. */
export function stepFrom(steps, i, dir) {
  const j = i + dir
  return j >= 0 && j < steps.length ? j : -1
}

/** The index of a step by id, or 0 when it is not (or no longer) in the list. */
export function indexOfStep(steps, id) {
  const i = steps.findIndex(s => s.id === id)
  return i < 0 ? 0 : i
}

// The sample session's routine, which exists only inside the tour's sandbox.
export const SAMPLE_ROUTINE_ID = 'tour-sample'

const GAP = 12, EDGE = 16
/**
 * Where the card goes beside a spotlight `hole` ({ top, left, width, height }, or null for the
 * middle): under it when it fits, else over it, else wherever there is more room, and never past
 * the screen's edges or the phone's own insets (`top`, `bottom`). Centred on the hole sideways.
 */
export function placeCard(hole, card, { vw, vh, top = 0, bottom = 0 }) {
  const minTop = top + EDGE, maxTop = Math.max(minTop, vh - bottom - EDGE - card.h)
  const clampTop = y => Math.min(maxTop, Math.max(minTop, y))
  const left = Math.round(Math.min(Math.max(EDGE, vw - EDGE - card.w), Math.max(EDGE, hole ? hole.left + hole.width / 2 - card.w / 2 : (vw - card.w) / 2)))
  if (!hole) return { top: Math.round(clampTop((vh - card.h) / 2)), left, side: 'center' }
  const below = vh - bottom - EDGE - (hole.top + hole.height + GAP)
  const above = hole.top - GAP - minTop
  if (below >= card.h) return { top: Math.round(hole.top + hole.height + GAP), left, side: 'below' }
  if (above >= card.h) return { top: Math.round(hole.top - GAP - card.h), left, side: 'above' }
  return below >= above
    ? { top: Math.round(clampTop(hole.top + hole.height + GAP)), left, side: 'below' }
    : { top: Math.round(clampTop(hole.top - GAP - card.h)), left, side: 'above' }
}

/* ---------------- the record: { offered, done, at, resumeAsked } ---------------- */

export function readTour() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function writeTour(patch) {
  const next = { ...readTour(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: asked again next time, no harm */ }
  return next
}

/** A step reached: the place a closed app picks up from. */
export const noteStep = id => writeTour({ at: id, resumeAsked: false })
/** Seen to the end, skipped or closed: never offered again (Settings can still run it). */
export const markTourDone = () => writeTour({ done: Date.now(), at: null })
/** The first-run question was asked; whatever the answer, it is not asked twice. */
export const markOffered = () => writeTour({ offered: Date.now() })
/** The "pick up where you left off" question was asked: once, as promised. */
export const markResumeAsked = () => writeTour({ resumeAsked: true })

/**
 * Whether to ask "Want a 1-minute tour?" now. Only on a first setup: never asked before on this
 * device, and a profile that has not logged anything yet (someone signing in with years of
 * history knows the way around). `synced`: the copy is the account's own, not one still on its
 * way down from the server.
 */
export function shouldOffer(record, S, { synced = true } = {}) {
  if (!S || record.offered || record.done || record.at) return false
  return synced && !S.active && !(S.workouts || []).length
}

/** The step a tour closed halfway can resume from, once: its id, or null. */
export function resumeAt(record) {
  return record.at && !record.done && !record.resumeAsked ? record.at : null
}

/* ---------------- open or not (the main bundle's side) ---------------- */

// null, { kind: 'offer' }, { kind: 'resume', at } or { kind: 'run', at }
let state = null
const subs = new Set()
const emit = () => { for (const f of subs) f() }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }

export const tourState = () => state
export const tourRunning = () => state?.kind === 'run'
export function openTour(next) { state = next; emit() }
export function closeTour() { if (state) { state = null; emit() } }
/** From Settings: from the top, whatever the record says. */
export const startTour = (at = null) => openTour({ kind: 'run', at })

export const useTour = () => useSyncExternalStore(subscribe, tourState, tourState)
/** Whether the tour is running: the seasonal decorations step aside meanwhile. */
export const useTourRunning = () => useSyncExternalStore(subscribe, tourRunning, tourRunning)

// Android back (lib/back.js) asks here first: the open tour takes the press and closes.
export function tourBack() {
  if (!state) return false
  if (state.kind === 'run') markTourDone()
  closeTour()
  return true
}
