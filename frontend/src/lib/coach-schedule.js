// Automatic reviews on a phone that brings its own API key (Discord, 10-19).
//
// On a server the cadence tick runs them (api/coach/cadence.js). A phone in BYOK mode has no
// server, and nothing ran them: "Weekly" and "After every few workouts" saved, and no review ever
// came. There is no running JavaScript while the app is closed, so the phone asks while it is
// open, with the server's rule (api/coach/core/due.js): on start, on every return to the
// foreground, and once a minute while on screen. That last one is what catches a workout the
// moment it is finished, and a weekly slot that passes with the app open.
//
// The check itself is cheap and says no early: anything but a phone in BYOK mode with automatic
// reviews on stops here, before the Coach's code is even loaded.
import { MOBILE } from './mobile.js'

const TICK_MS = 60000

/** Whether this state could have a review due here at all, before anything is loaded. */
export function mayBeDue(store) {
  const cadence = store?.S?.coach?.cadence
  return store?.coachLocal?.mode === 'byok' && !!cadence && cadence !== 'off'
}

let running = false
/** One look: runs the review when it is due. Resolves to the started job, or null. */
export async function checkScheduledReview(getStore) {
  if (running || !mayBeDue(getStore())) return null
  running = true
  try {
    const { scheduledReview } = await import('./coach-api.js')
    return await scheduledReview()
  } catch { return null } finally { running = false }
}

let started = false
export function initCoachSchedule(getStore) {
  if (!MOBILE || started) return
  started = true
  const look = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    checkScheduledReview(getStore)
  }
  setTimeout(look, 5000)                  // after start-up, not in the middle of it
  setInterval(look, TICK_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', look)
  // The same promise rule as initReminderSync (lib/mobile.js): returned into the catch.
  import('@capacitor/app').then(({ App }) =>
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) look() })
  ).catch(() => {})
}
