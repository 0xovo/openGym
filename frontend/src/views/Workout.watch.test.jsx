// @vitest-environment happy-dom
// A set ticked on the Apple Watch runs the workout screen's own tick (lib/watch-sync.js): the
// weight and reps from the watch go into the row, the row is done, and the rest starts, exactly
// as a tap on the phone does it. Applied once, however often the event arrives.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { _resetHintQuiet } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { applyEvents, _resetWatchSync } from '../lib/watch-sync.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
let root, container

beforeEach(() => {
  _resetHintQuiet(); _resetWatchSync()
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, swipeHint: null })
  const S = clone(DEF)
  S.hints = { swipeSets: true }
  S.restSec = 90
  S.active = { id: 'w-watch', d: '2026-10-13', start: Date.now(), name: 'Watch test', cur: 0,
    entries: [{ id: '0025', target: { sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }] }
  useStore.setState({ S, user: null })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
})
afterEach(() => {
  act(() => root.unmount()); container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers(); vi.useRealTimers()
})

describe('a set ticked on the watch', () => {
  it('takes the watch\'s numbers, is ticked by the screen\'s own tick, and starts the rest', () => {
    const ev = { id: 'e1', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 62.5, r: 7, at: 1 }
    act(() => { applyEvents([ev, ev], () => useStore.getState()) })
    const set = useStore.getState().S.active.entries[0].sets[0]
    expect(set).toMatchObject({ w: 62.5, r: 7, done: true })
    expect(typeof set.at).toBe('number')
    expect(useUI.getState().timer).toBeTruthy()           // the rest the tap would have started
    expect(useStore.getState().S.active.entries[0].sets[1].done).toBe(false)
    act(() => { applyEvents([ev], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)   // not toggled back off
  })

  it('a row already ticked on the phone only takes the numbers', () => {
    act(() => { useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }) })
    act(() => { applyEvents([{ id: 'e2', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 65, r: 6 }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 65, r: 6, done: true })
  })

  it('keeps the watch\'s time on the set, and the watch\'s Finish saves the workout like Finish and save', () => {
    const at = Date.now() - 60000
    act(() => { applyEvents([{ id: 'e3', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0].at).toBe(at)
    act(() => { applyEvents([{ id: 'f1', type: 'finish', wid: 'w-watch', at: at + 1000 }], () => useStore.getState()) })
    const S = useStore.getState().S
    expect(S.active).toBeNull()
    expect(S.workouts.at(-1)).toMatchObject({ id: 'w-watch' })
    expect(S.workouts.at(-1).entries[0].sets[0]).toMatchObject({ w: 60, r: 8, done: true, at })
  })
})

describe('the same set on both sides', () => {
  it('a tick from the watch older than the phone\'s own keeps the phone\'s numbers, and its heart rate lands', () => {
    act(() => { useStore.getState().update(s => { Object.assign(s.active.entries[0].sets[0], { w: 70, r: 5, done: true, at: 5000 }) }) })
    act(() => { applyEvents([{ id: 'old', type: 'setDone', wid: 'w-watch', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 4000, hr: { avg: 120, max: 130 } }], () => useStore.getState()) })
    expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 70, r: 5, done: true, at: 5000, hr: { avg: 120, max: 130 } })
  })
})
