// @vitest-environment happy-dom
// The Apple Watch link, the page's side: the snapshot the watch runs a session from, and the
// watch's events applied once each through the workout screen's own actions, drained from the
// native queue and acknowledged only when done.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot, buildReady, applyEvents, bindWatchActions, bindWatchAppActions, drainWatchEvents, _setWatchPluginForTest, _resetWatchSync, SNAPSHOT_VERSION } from './watch-sync.js'

const state = (over = {}) => ({
  unit: 'kg', restSec: 90, workouts: [], routines: [],
  active: {
    id: 'w-1', name: 'Push day', cur: 1, d: '2026-10-13',
    entries: [
      { id: '0025', target: { sets: 2, reps: 8, weight: 60 }, sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] },
      { id: '0001', target: { sets: 1, reps: 10, restSec: 120 }, sets: [{ w: 20, r: 10, done: false, phase: 'warmup' }] },
    ],
  },
  ...over,
})

beforeEach(() => { localStorage.clear(); _resetWatchSync() })
afterEach(() => _resetWatchSync())

describe('the snapshot', () => {
  it('carries what the watch needs to run the session, and nothing else', () => {
    const snap = buildSnapshot(state(), { timer: { endsAt: 1760000000000 } })
    expect(snap.v).toBe(SNAPSHOT_VERSION)
    expect(snap.active).toMatchObject({ id: 'w-1', name: 'Push day', unit: 'kg', cur: 1, restSec: 90, rest: { endsAt: 1760000000000 } })
    expect(snap.active.entries).toHaveLength(2)
    const [a, b] = snap.active.entries
    expect(a).toMatchObject({ id: '0025', mode: 'reps', restSec: null, last: null })
    expect(typeof a.name).toBe('string')
    expect(a.name.length).toBeGreaterThan(0)
    expect(a.sets).toEqual([{ w: 60, r: 8, sec: null, done: true, warmup: false }, { w: 60, r: 8, sec: null, done: false, warmup: false }])
    expect(b.restSec).toBe(120)
    expect(b.sets[0].warmup).toBe(true)
    // plain data only: no media, no image or animation paths
    expect(JSON.stringify(snap)).not.toMatch(/\.(gif|webp|png|jpg|mp4)|media|img/i)
  })

  it('says there is no workout when none runs, and no rest when it is paused or over', () => {
    expect(buildSnapshot({ unit: 'kg' })).toEqual({ v: SNAPSHOT_VERSION, unit: 'kg', active: null, ready: null })
    expect(buildSnapshot(state(), { timer: { endsAt: 5, paused: true } }).active.rest).toBeNull()
    expect(buildSnapshot(state(), { timer: { endsAt: 5, ready: true } }).active.rest).toBeNull()
    expect(buildSnapshot(state({ unit: 'lb' })).active.unit).toBe('lb')
  })

  it('names the last time of an exercise when the history has one', () => {
    const S = state({ workouts: [{ id: 'old', d: '2026-10-01', entries: [{ id: '0025', target: { sets: 2, reps: 8 }, sets: [{ w: 55, r: 8, done: true }, { w: 55, r: 7, done: true }] }] }] })
    expect(buildSnapshot(S).active.entries[0].last).toMatch(/55/)
  })
})

describe('the events from the watch', () => {
  const ev = (id, over = {}) => ({ id, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 62.5, r: 7, at: 1, ...over })

  it('go through the workout screen\'s own action, once each', () => {
    const S = state()
    const setDone = vi.fn()
    bindWatchActions({ setDone })
    expect(applyEvents([ev('a'), ev('a')], () => ({ S }))).toEqual(['a', 'a'])
    expect(setDone).toHaveBeenCalledTimes(1)
    expect(setDone).toHaveBeenCalledWith(0, 1, { w: 62.5, r: 7, at: 1 })
    // …and again later (a second drain, a restart of the page): still once
    expect(applyEvents([ev('a')], () => ({ S }))).toEqual(['a'])
    expect(setDone).toHaveBeenCalledTimes(1)
  })

  it('find their exercise when the phone moved it, and drop what no longer exists', () => {
    const S = state()
    S.active.entries.reverse()
    const setDone = vi.fn()
    bindWatchActions({ setDone })
    expect(applyEvents([ev('moved'), ev('gone', { exId: '9999', entryIdx: 5 }), ev('other', { wid: 'w-2' })], () => ({ S }))).toEqual(['moved', 'gone', 'other'])
    expect(setDone).toHaveBeenCalledTimes(1)
    expect(setDone).toHaveBeenCalledWith(1, 1, { w: 62.5, r: 7, at: 1 })
  })

  it('wait in the queue while the workout screen is not there', () => {
    expect(applyEvents([ev('a')], () => ({ S: state() }))).toEqual([])
  })
})

describe('the native queue', () => {
  const plugin = events => ({ drain: vi.fn(async () => ({ events })), ack: vi.fn(async () => {}) })

  it('is drained when the workout screen binds, and acknowledged only for what was done', async () => {
    const S = state()
    const p = plugin([{ id: 'x1', type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, w: 60, r: 8 }])
    _setWatchPluginForTest(p, () => ({ S }))
    const setDone = vi.fn()
    bindWatchActions({ setDone })
    await drainWatchEvents()
    expect(setDone).toHaveBeenCalledWith(0, 1, { w: 60, r: 8, at: null })
    expect(p.ack).toHaveBeenCalledWith({ ids: ['x1'] })
  })

  it('without the workout screen nothing is acknowledged: the events stay for later', async () => {
    const p = plugin([{ id: 'x1', type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1 }])
    _setWatchPluginForTest(p, () => ({ S: state() }))
    expect(await drainWatchEvents()).toEqual([])
    expect(p.ack).not.toHaveBeenCalled()
  })

  it('off the iPhone app there is no plugin and nothing happens', async () => {
    _setWatchPluginForTest(null, () => ({ S: state() }))
    bindWatchActions({ setDone: vi.fn() })
    expect(await drainWatchEvents()).toEqual([])
  })
})

describe('starting and finishing on the watch', () => {
  const routines = [
    { id: 'r-push', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60 }] },
    { id: 'r-pull', name: 'Pull', ex: [{ id: '0001', sets: 2, reps: 10 }] },
  ]

  it('the phone keeps today\'s session and the other routines ready, built as Start builds them', () => {
    const S = { unit: 'kg', workouts: [], routines, week: { 2: 'r-push' }, dayPlan: {} }
    const ready = buildReady(S, '2026-10-13')   // a Tuesday
    expect(ready.today).toMatchObject({ routineIds: ['r-push'], name: 'Push' })
    expect(ready.today.entries[0].sets).toHaveLength(3)
    expect(ready.others.map(o => o.routineIds)).toEqual([['r-pull']])
    const snap = buildSnapshot(S, { ready })
    expect(snap.active).toBeNull()
    expect(snap.ready.today.name).toBe('Push')
  })

  it('a start from the watch starts the session with the watch\'s id and time, once; the sets after it wait for the workout screen', () => {
    let S = { active: null }
    const start = vi.fn((ids, opts) => { S = { active: { id: opts.id, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: false }] }] } } })
    bindWatchAppActions({ start })
    const events = [
      { id: 's1', type: 'start', routineIds: ['r-push'], wid: 'watch-1', at: 1700000000000 },
      { id: 'd1', type: 'setDone', wid: 'watch-1', exId: '0025', entryIdx: 0, setIdx: 0, w: 60, r: 8, at: 1700000100000 },
    ]
    expect(applyEvents(events, () => ({ S }))).toEqual(['s1'])
    expect(start).toHaveBeenCalledWith(['r-push'], { id: 'watch-1', start: 1700000000000 })
    const setDone = vi.fn(), finish = vi.fn()
    bindWatchActions({ setDone, finish })
    expect(applyEvents([...events, { id: 'f1', type: 'finish', wid: 'watch-1', at: 1700000200000 }], () => ({ S }))).toEqual(['s1', 'd1', 'f1'])
    expect(start).toHaveBeenCalledTimes(1)
    expect(setDone).toHaveBeenCalledWith(0, 0, { w: 60, r: 8, at: 1700000100000 })
    expect(finish).toHaveBeenCalledTimes(1)
  })

  it('a start while another workout runs on the phone keeps that one', () => {
    const S = { active: { id: 'phone-1', entries: [] } }
    const start = vi.fn()
    bindWatchAppActions({ start })
    expect(applyEvents([{ id: 's2', type: 'start', routineIds: ['r'], wid: 'watch-2', at: 1 }], () => ({ S }))).toEqual(['s2'])
    expect(start).not.toHaveBeenCalled()
  })
})
