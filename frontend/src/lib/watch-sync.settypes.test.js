// @vitest-environment happy-dom
// Every kind of set reaches the watch with what it needs, and comes back right: bodyweight,
// per-side (two sides, each ticked on its own), holds (seconds), supersets (group), warm-ups,
// the best set before today (the watch's PRs) and the workout's start (its summary).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot, applyEvents, bindWatchAppActions, patchSetIn, _resetWatchSync } from './watch-sync.js'

beforeEach(() => { localStorage.clear(); _resetWatchSync() })

const sideRow = (Ld = false) => ({ w: 20, r: 16, done: false, sides: { L: { w: 20, r: 8, done: Ld }, R: { w: 20, r: 8, done: false } } })

const S = () => ({
  unit: 'kg', restSec: 90, routines: [],
  workouts: [{ id: 'old', d: '2026-10-01', start: 1, entries: [
    { id: '0025', target: { sets: 1, reps: 8 }, sets: [{ w: 80, r: 5, done: true }, { w: 85, r: 3, done: true }] },
    { id: 'plank', target: { mode: 'time', sec: 30 }, sets: [{ sec: 50, done: true }] },
  ] }],
  active: {
    id: 'w-1', name: 'Mixed', cur: 0, d: '2026-10-14', start: 1_800_000_000_000,
    entries: [
      { id: '0025', target: { sets: 2, reps: 8, weight: 80 }, sets: [{ w: 40, r: 10, done: false, phase: 'warmup' }, { w: 80, r: 6, done: false }] },
      { id: 'plank', target: { mode: 'time', sec: 45 }, sets: [{ sec: 45, done: false }] },
      { id: 'pull', target: { sets: 1, reps: 8, bodyweight: true }, sets: [{ w: 0, r: 8, done: false }] },
      { id: 'split', target: { sets: 1, reps: 16, side: true }, sets: [sideRow(true)] },
      { id: 'curl', sg: 'g1', target: { sets: 1, reps: 10 }, sets: [{ w: 12, r: 10, done: false }] },
      { id: 'push', sg: 'g1', target: { sets: 1, reps: 12 }, sets: [{ w: 25, r: 12, done: false }] },
      { id: '1431', target: { sets: 1, reps: 8 }, sets: [{ w: 30, r: 8, done: false }] },
    ],
  },
})

describe('the snapshot carries every kind of set', () => {
  const snap = buildSnapshot(S())
  const [bench, plank, pull, split, curl, push, assisted] = snap.active.entries

  it('the workout\'s start, for the summary', () => { expect(snap.active.start).toBe(1_800_000_000_000) })
  it('warm-ups marked, and the best set before today', () => {
    expect(bench.sets[0].warmup).toBe(true)
    expect(bench.sets[1].warmup).toBe(false)
    expect(bench.best).toEqual({ w: 85, r: 3 })
  })
  it('holds with their seconds and their longest one', () => {
    expect(plank.mode).toBe('time')
    expect(plank.sets[0].sec).toBe(45)
    expect(plank.best).toEqual({ sec: 50, w: null })
  })
  it('bodyweight', () => { expect(pull.bodyweight).toBe(true); expect(bench.bodyweight).toBeUndefined() })
  it('per-side sets with both sides', () => {
    expect(split.perSide).toBe(true)
    expect(split.sets[0].sides).toEqual({ L: { w: 20, r: 8, done: true }, R: { w: 20, r: 8, done: false } })
    expect(bench.sets[1].sides).toBeUndefined()
  })
  it('supersets by their group, only where there is one', () => {
    expect(curl.group).toBe('g1')
    expect(push.group).toBe('g1')
    expect(bench.group).toBeUndefined()
  })
  it('assisted exercises, where lighter is better', () => {
    expect(assisted.assisted).toBe(true)
    expect(bench.assisted).toBeUndefined()
  })
  it('no best for an exercise never done before', () => { expect(curl.best).toBeUndefined() })
})

describe('ticks of every kind', () => {
  it('a per-side tick for a workout the phone already saved goes into that side', () => {
    const s = { active: null, workouts: [{ id: 'w-old', entries: [{ id: 'split', sets: [sideRow()] }] }] }
    const stamp = vi.fn()
    expect(patchSetIn(s, { wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'L' }, { done: true, w: 22.5, r: 8, at: 5 }, stamp)).toBe(true)
    const row = s.workouts[0].entries[0].sets[0]
    expect(row.sides.L).toMatchObject({ w: 22.5, r: 8, done: true })
    expect(row).toMatchObject({ done: false, r: 16, w: 22.5, at: 5 })
    patchSetIn(s, { wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'R' }, { done: true, w: 20, r: 7, at: 6 }, stamp)
    expect(s.workouts[0].entries[0].sets[0]).toMatchObject({ done: true, r: 15 })
    expect(stamp).toHaveBeenCalledTimes(2)
  })

  it('side and seconds reach the app\'s handler for a saved workout, and nothing extra for a plain set', () => {
    const patchSet = vi.fn()
    bindWatchAppActions({ start: vi.fn(), patchSet })
    const getState = () => ({ S: { active: null, workouts: [{ id: 'w-old', entries: [] }] } })
    applyEvents([
      { id: 'a', type: 'setDone', wid: 'w-old', exId: 'split', entryIdx: 0, setIdx: 0, side: 'L', w: 20, r: 8, at: 1 },
      { id: 'b', type: 'setDone', wid: 'w-old', exId: 'plank', entryIdx: 1, setIdx: 0, sec: 40, at: 2 },
      { id: 'c', type: 'setDone', wid: 'w-old', exId: '0025', entryIdx: 2, setIdx: 0, w: 60, r: 8, side: 'X', at: 3 },
    ], getState)
    expect(patchSet.mock.calls[0][0]).toMatchObject({ side: 'L' })
    expect(patchSet.mock.calls[1][1]).toMatchObject({ sec: 40, done: true })
    expect(patchSet.mock.calls[2][0].side).toBeUndefined()
  })
})
