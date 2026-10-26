// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  STEPS, tourSteps, stepFrom, indexOfStep, readTour, noteStep, markTourDone, markOffered, markResumeAsked,
  shouldOffer, resumeAt, placeCard, openTour, closeTour, tourState, tourRunning, startTour, tourBack,
} from './tour.js'

const fresh = { workouts: [], routines: [], active: null }
beforeEach(() => { localStorage.clear(); closeTour() })
afterEach(() => { localStorage.clear(); closeTour() })

describe('steps', () => {
  it('runs Home, Plan, Library, the workout, Stats, Settings and a closing card, in that order', () => {
    const routes = tourSteps({}).map(s => s.route).filter((r, i, all) => r !== all[i - 1])
    expect(routes).toEqual(['/home', '/plan', '/library', '/workout', '/stats', '/settings', '/home'])
    expect(tourSteps({}).at(-1)).toMatchObject({ id: 'done', anchor: null })
  })
  it('leaves out what a profile has nothing to show for, and keeps it for one that has', () => {
    const empty = tourSteps({}).map(s => s.id)
    expect(empty).not.toContain('plan-body')
    expect(empty).not.toContain('stats-records')
    expect(empty).not.toContain('rest')
    const full = tourSteps({ plannedDays: true, rest: true, swipe: true, balance: true, workouts: true }).map(s => s.id)
    expect(full).toEqual(STEPS.map(s => s.id))
  })
  it('only the workout stops run on the practice session, and they sit together', () => {
    const steps = tourSteps({ rest: true, swipe: true })
    const idx = steps.map((s, i) => (s.practice ? i : -1)).filter(i => i >= 0)
    expect(idx.length).toBeGreaterThan(3)
    expect(idx.at(-1) - idx[0] + 1).toBe(idx.length)
    expect(steps.filter(s => s.practice).every(s => s.route === '/workout')).toBe(true)
  })
  it('moves one stop at a time and says when it runs off either end', () => {
    const steps = tourSteps({})
    expect(stepFrom(steps, 0, 1)).toBe(1)
    expect(stepFrom(steps, 0, -1)).toBe(-1)
    expect(stepFrom(steps, steps.length - 1, 1)).toBe(-1)
    expect(indexOfStep(steps, 'lib-search')).toBe(steps.findIndex(s => s.id === 'lib-search'))
    // a stop this profile does not have (the record came from another one) starts from the top
    expect(indexOfStep(steps, 'plan-body')).toBe(0)
  })
})

describe('the record on this device', () => {
  it('asks once, on a first setup only', () => {
    expect(shouldOffer(readTour(), fresh)).toBe(true)
    markOffered()
    expect(shouldOffer(readTour(), fresh)).toBe(false)
  })
  it('never asks a profile that has logged workouts, one mid-workout, or a copy still syncing', () => {
    expect(shouldOffer({}, { ...fresh, workouts: [{ id: 'w' }] })).toBe(false)
    expect(shouldOffer({}, { ...fresh, active: { id: 'a' } })).toBe(false)
    expect(shouldOffer({}, fresh, { synced: false })).toBe(false)
  })
  it('a tour closed halfway is offered to finish once, then not again', () => {
    noteStep('stats')
    expect(resumeAt(readTour())).toBe('stats')
    markResumeAsked()
    expect(resumeAt(readTour())).toBe(null)
    noteStep('look')   // they said yes and went on: a new halfway point asks again
    expect(resumeAt(readTour())).toBe('look')
    markTourDone()
    expect(resumeAt(readTour())).toBe(null)
    expect(shouldOffer(readTour(), fresh)).toBe(false)
  })
  it('keeps no record in the synced state, only in this browser', () => {
    noteStep('today')
    expect(Object.keys(localStorage)).toEqual(['gym_tour_v1'])
  })
})

describe('open or not', () => {
  it('Settings starts it from the top, whatever the record says', () => {
    markTourDone()
    startTour()
    expect(tourState()).toEqual({ kind: 'run', at: null })
    expect(tourRunning()).toBe(true)
  })
  it('back closes it, and a running tour closed by back counts as seen', () => {
    expect(tourBack()).toBe(false)
    openTour({ kind: 'run', at: 'plan-mode' })
    expect(tourBack()).toBe(true)
    expect(tourState()).toBe(null)
    expect(readTour().done).toBeGreaterThan(0)
  })
})

describe('placeCard', () => {
  const card = { w: 300, h: 160 }
  const view = { vw: 390, vh: 800, top: 40, bottom: 30 }
  it('goes under the spotlight when it fits', () => {
    expect(placeCard({ top: 100, left: 20, width: 200, height: 50 }, card, view)).toMatchObject({ side: 'below', top: 162 })
  })
  it('goes over it near the bottom (the Start button)', () => {
    const p = placeCard({ top: 700, left: 150, width: 90, height: 60 }, card, view)
    expect(p.side).toBe('above')
    expect(p.top + card.h).toBeLessThanOrEqual(700)
  })
  it('stays inside the screen and the phone’s insets at 320 px', () => {
    const p = placeCard({ top: 300, left: 280, width: 40, height: 40 }, { w: 288, h: 200 }, { vw: 320, vh: 568, top: 20, bottom: 20 })
    expect(p.left).toBeGreaterThanOrEqual(16)
    expect(p.left + 288).toBeLessThanOrEqual(320 - 16)
  })
  it('a tall spotlight with no room either side keeps the card on screen', () => {
    const p = placeCard({ top: 60, left: 0, width: 390, height: 700 }, card, view)
    expect(p.top).toBeGreaterThanOrEqual(56)
    expect(p.top + card.h).toBeLessThanOrEqual(800 - 30 - 16)
  })
  it('no spotlight: the middle', () => {
    expect(placeCard(null, card, view)).toMatchObject({ side: 'center', left: 45 })
  })
})
