// Swipe from the left edge to go back, the iPhone way (owner request).
//
// Only where the screen shows its own back button: every page-level back arrow carries
// `data-back`, and the gesture does exactly what that button does, by clicking it. No button,
// no gesture: a tab root, the workout screen, anything behind an open sheet. So it can never
// leave the app or go somewhere the screen does not offer.
//
// Only on iOS and only where nothing else does it: the iPhone/iPad app (Capacitor, whose web
// view has no back gesture of its own) and the home-screen web app (standalone, where Safari's
// edge swipe is gone). Android has its system back (lib/back.js), a Safari tab has its own.
//
// Only from the edge (EDGE_PX), so the swipe cards, the set rows, the chip strips and the sliders
// keep every touch that starts anywhere else. A touch that does start at the edge is claimed
// before any of them sees it (a capture listener on the window), and given back by no one: a
// set row under the thumb at the very edge does not open while the page goes back.
//
// The page follows the finger over a dimmed backdrop (the previous page is not rendered, so
// the backdrop stands in for it); past a third of the width, or flicked, it goes; otherwise it
// springs back. With reduced motion nothing moves: the same decision, then just the navigation.
// Right-to-left languages mirror all of it: the right edge, swiping left.
import { MOBILE, nativePlatform } from './mobile.js'

export const EDGE_PX = 20          // how close to the edge a back swipe must start
export const SLOP_PX = 10          // movement before the gesture decides sideways or not
export const COMMIT_FRACTION = 1 / 3
export const FLICK_PX_PER_MS = 0.5 // a flick this fast goes back from any distance past the slop
const SETTLE_MS = 260

/* ---------- pure decisions ---------- */

/** Whether this build and device get the gesture at all. */
export function edgeSwipeEnabled({ mobile, platform, ios, standalone }) {
  if (mobile) return platform === 'ios'
  return !!ios && !!standalone
}

/** Whether a touch at clientX starts in the back edge (the right one in RTL). */
export function startsAtEdge(x, width, rtl = false, edge = EDGE_PX) {
  return rtl ? x >= width - edge : x <= edge
}

/** The distance travelled towards "back": positive to the right, or to the left in RTL. */
export const progressOf = (x0, x, rtl = false) => (rtl ? x0 - x : x - x0)

/**
 * Sideways or not, once the finger has moved past the slop: 'go' for a back swipe, 'abort' for
 * a scroll (more vertical than sideways) or a swipe the wrong way, null to keep waiting.
 */
export function lockOf(dx, dy, slop = SLOP_PX) {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null
  if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) return 'abort'
  return 'go'
}

/** On release: 'back' past COMMIT_FRACTION of the width or with a flick, 'cancel' otherwise. */
export function releaseOf({ dx, width, vx }) {
  if (dx <= 0) return 'cancel'
  if (dx >= width * COMMIT_FRACTION) return 'back'
  if (vx >= FLICK_PX_PER_MS && dx > SLOP_PX) return 'back'
  return 'cancel'
}

/* ---------- where the gesture acts ---------- */

/** The page's own back button, or null: visible, enabled, and not behind an open sheet. */
export function backTarget(doc = document) {
  if (doc.querySelector('#modal-root.open')) return null
  const el = doc.querySelector('#app [data-back]')
  if (!el || el.disabled) return null
  return el
}

const reducedMotion = win => { try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }
const isRtl = doc => (doc.documentElement.dir || '').toLowerCase() === 'rtl'

/* ---------- the gesture ---------- */

/**
 * Installs the listeners. `opts.enabled` forces the platform answer (tests); otherwise it is
 * worked out once. Returns a function that removes everything again.
 */
export function installEdgeSwipeBack(win = window, opts = {}) {
  const doc = win.document
  let enabled = opts.enabled
  if (enabled === undefined) {
    enabled = false
    const ios = /iPhone|iPad|iPod/.test(win.navigator.userAgent) ||
      (/Macintosh/.test(win.navigator.userAgent) && (win.navigator.maxTouchPoints || 0) > 1)   // iPadOS
    let standalone = false
    try { standalone = !!(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator.standalone === true) } catch { /* not standalone */ }
    if (MOBILE) nativePlatform().then(p => { enabled = edgeSwipeEnabled({ mobile: true, platform: p }) })
    else enabled = edgeSwipeEnabled({ mobile: false, ios, standalone })
  }

  let g = null   // { id, x0, y0, t, x, lastX, lastT, vx, rtl, width, target, lock, page, shade }

  const paint = (dx, ms = 0) => {
    if (!g || !g.page) return
    const off = Math.max(0, dx) * (g.rtl ? -1 : 1)
    const tr = ms ? `transform ${ms}ms cubic-bezier(.32,.72,0,1)` : 'none'
    g.page.style.transition = tr
    g.page.style.transform = off ? `translateX(${off}px)` : ''
    if (g.shade) {
      g.shade.style.transition = ms ? `opacity ${ms}ms linear` : 'none'
      g.shade.style.opacity = String(Math.max(0, 1 - dx / g.width) * 0.35)
    }
  }
  const startVisual = () => {
    if (reducedMotion(win)) return
    const page = doc.getElementById('app')
    if (!page) return
    g.page = page
    page.classList.add('edge-back-page')
    const shade = doc.createElement('div')
    shade.className = 'edge-back-shade'
    page.parentNode.insertBefore(shade, page)
    g.shade = shade
  }
  const endVisual = gesture => {
    if (gesture.page) { gesture.page.style.transition = ''; gesture.page.style.transform = ''; gesture.page.classList.remove('edge-back-page') }
    gesture.shade?.remove()
  }

  const onDown = e => {
    if (!enabled || g || (e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen')) return
    const rtl = isRtl(doc)
    const width = win.innerWidth || doc.documentElement.clientWidth
    if (!startsAtEdge(e.clientX, width, rtl)) return
    const target = backTarget(doc)
    if (!target) return
    // Claimed: nothing under the edge (a set row, a card) starts its own swipe from this touch.
    e.stopPropagation()
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp || Date.now(), vx: 0, rtl, width, target, lock: null }
  }
  const onMove = e => {
    if (!g || e.pointerId !== g.id) return
    e.stopPropagation()
    const dx = progressOf(g.x0, e.clientX, g.rtl)
    const now = e.timeStamp || Date.now()
    const dt = now - g.lastT
    if (dt > 0) g.vx = progressOf(g.lastX, e.clientX, g.rtl) / dt
    g.lastX = e.clientX; g.lastT = now
    if (!g.lock) {
      g.lock = lockOf(dx, e.clientY - g.y0)
      if (g.lock === 'abort') { const done = g; g = null; endVisual(done); return }
      if (g.lock === 'go') startVisual()
      else return
    }
    paint(dx)
  }
  const onUp = e => {
    if (!g || e.pointerId !== g.id) return
    e.stopPropagation()
    const done = g
    g = null
    if (done.lock !== 'go') { endVisual(done); return }
    const dx = progressOf(done.x0, e.clientX, done.rtl)
    const go = releaseOf({ dx, width: done.width, vx: done.vx }) === 'back' && e.type !== 'pointercancel'
    if (!done.page) { endVisual(done); if (go) done.target.click(); return }
    g = done   // for paint
    paint(go ? done.width : 0, SETTLE_MS)
    g = null
    win.setTimeout(() => {
      if (go) done.target.click()
      endVisual(done)
    }, SETTLE_MS)
  }
  // A claimed touch must not scroll the page under it: pointer events alone do not stop a WebKit
  // scroll, and a scroll that starts in the slop cancels the pointer. Only touches that began in
  // the back edge of a page with a back button are held like this.
  const onTouchMove = e => { if (g && e.cancelable) e.preventDefault() }

  win.addEventListener('pointerdown', onDown, true)
  win.addEventListener('pointermove', onMove, true)
  win.addEventListener('pointerup', onUp, true)
  win.addEventListener('pointercancel', onUp, true)
  doc.addEventListener('touchmove', onTouchMove, { passive: false })
  return () => {
    win.removeEventListener('pointerdown', onDown, true)
    win.removeEventListener('pointermove', onMove, true)
    win.removeEventListener('pointerup', onUp, true)
    win.removeEventListener('pointercancel', onUp, true)
    doc.removeEventListener('touchmove', onTouchMove)
    if (g) { endVisual(g); g = null }
  }
}
