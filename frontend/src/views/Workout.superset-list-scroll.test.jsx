import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { makeSideSet } from '../lib/workout-model.js'

// In list and compact view a superset is one `.wl-unit`, so moving the marker from one member to
// the next does not change which unit is "current": scrolling to `.wl-unit.cur` is a no-op. The
// member rows carry their own refs all the same, so completing a set still brings the next
// member's actionable row into view — the same anchor the cards view gives (issue: supersets no
// longer scroll to where you continue in list/compact, one-sided exercises most visibly).
const mocks = vi.hoisted(() => {
  const state = {
    S: null, timer: null, work: null,
    startRest: vi.fn(), startWork: vi.fn(), toast: vi.fn(), menuSheet: vi.fn(),
    stopRest: null, stopWork: null,
    afterScrollRestore: vi.fn(fn => { fn(); return () => {} }),
    scrollRestorePending: vi.fn(() => false),
  }
  state.stopRest = vi.fn(() => { state.timer = null })
  state.stopWork = vi.fn(() => { state.work = null })
  state.storeSnapshot = () => ({
    S: state.S, user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  state.uiSnapshot = () => ({
    timer: state.timer, work: state.work,
    startRest: state.startRest, stopRest: state.stopRest, stopWork: state.stopWork,
    shiftRestOwner: vi.fn(), startWork: state.startWork, toast: state.toast,
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(), finishWorkoutSheet: vi.fn(), exitWorkoutEdit: vi.fn(), workoutCompleteSheet: vi.fn(), confirmSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(), menuSheet: mocks.menuSheet, barWeightSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(), sessionNoteSheet: vi.fn(), renameWorkoutSheet: vi.fn(),
  effortPickerSheet: vi.fn(), exerciseHistorySheet: vi.fn(), addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../components/Modals.jsx', () => ({ afterScrollRestore: mocks.afterScrollRestore, scrollRestorePending: mocks.scrollRestorePending }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

let dom, root, container

const normal = (id, sg) => ({
  id, sg,
  target: { mode: 'reps', sets: 2, reps: 8, weight: 60, restSec: 60 },
  sets: Array.from({ length: 2 }, () => ({ r: 8, w: 60, done: false })),
})
const oneSided = (id, sg) => ({
  id, sg,
  target: { mode: 'reps', side: true, sets: 2, reps: 16, weight: 20, restSec: 60 },
  sets: Array.from({ length: 2 }, () => makeSideSet({ r: 16, w: 20 })),
})

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  dom.Element.prototype.scrollIntoView = vi.fn()
  dom.requestAnimationFrame = cb => { cb(); return 0 }
  dom.cancelAnimationFrame = () => {}
  dom.matchMedia = () => ({ matches: false })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

// The partner member's rows sit below the first member's in the one superset card. We watch the
// element scrollIntoView was called on.
async function mount(entries, cur = 0, view = 'list') {
  mocks.S = {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full', collapseCompleted: false,
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test', start: Date.now(), cur, entries, workoutView: view },
  }
  installDom()
  dom.innerHeight = 659
  // Everything on screen by default; a test overrides geometry where it matters.
  dom.Element.prototype.getBoundingClientRect = () => ({ top: 400, bottom: 444, left: 0, right: 390, width: 390, height: 44 })
  await act(async () => { root.render(React.createElement(Workout)) })
}
const rerender = () => act(async () => { root.render(React.createElement(Workout)) })
async function press(button) { expect(button).toBeTruthy(); await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) }) }
const watchScrolls = () => { const seen = []; dom.Element.prototype.scrollIntoView = vi.fn(function () { seen.push(this) }); return seen }
const box = pred => [...container.querySelectorAll('[role="checkbox"]')].find(b => pred(b.getAttribute('aria-label') || ''))

beforeEach(() => {
  mocks.timer = null; mocks.work = null
  mocks.afterScrollRestore.mockReset(); mocks.afterScrollRestore.mockImplementation(fn => { fn(); return () => {} })
  mocks.scrollRestorePending.mockReset(); mocks.scrollRestorePending.mockImplementation(() => false)
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null; container = null; dom = null
})

for (const view of ['list', 'compact']) {
  describe(`${view} view: a superset scrolls to the next member`, () => {
    it('a normal member completing moves to the partner row', async () => {
      await mount([normal('0025', 'g'), normal('0043', 'g'), normal('0001')], 0, view)
      // The header has a height, so the list feeds it to --whdr-h and the row clears it.
      Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.className?.includes('whdr') && !this.className.includes('whdr-') ? 120 : 0 } })
      const seen = watchScrolls()
      // first member A set 0 — its checkbox is the first on screen
      await press(container.querySelector('[role="checkbox"]'))
      await rerender()
      expect(mocks.S.active.cur).toBe(1)
      // The partner B's first row is the 3rd .setrow (A has 2, then B's first).
      const partnerRow = container.querySelectorAll('.setrow')[2]
      expect(seen).toContain(partnerRow)
      // The row is scrolled to the top under the pinned header, with the header's height fed to
      // --whdr-h so the row's scroll-margin (index.css) clears it rather than hiding behind it.
      expect(container.querySelector('.workout-list').style.getPropertyValue('--whdr-h')).toBe('120px')
    })

    it('a one-sided member scrolls to the partner once both sides are ticked', async () => {
      await mount([oneSided('0025', 'g'), normal('0043', 'g'), normal('0001')], 0, view)
      const seen = watchScrolls()
      // A set 0 Left — no advance, no scroll yet
      await press(box(l => /Left/.test(l) && /Set 1/.test(l))); await rerender()
      expect(mocks.S.active.cur).toBe(0)
      expect(seen).toHaveLength(0)
      // A set 0 Right — set done, advance to partner B, scroll to B's row
      await press(box(l => /Right/.test(l) && /Set 1/.test(l))); await rerender()
      expect(mocks.S.active.cur).toBe(1)
      // A (one-sided) rows carry both `setrow` and `side`; B (normal) rows are a plain `.setrow`.
      // The partner is B's first unticked plain row.
      const partnerRow = [...container.querySelectorAll('.setrow:not(.side)')].find(el => !el.className.includes('done'))
      expect(partnerRow).toBeTruthy()
      expect(seen).toContain(partnerRow)
    })
  })
}
