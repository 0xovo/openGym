// @vitest-environment happy-dom
/* The app tour's overlay: the first-run question and the resume question, the stops in order,
   Back / Next / Skip, a tap on the highlighted element, Escape and the focus trap, reduced motion,
   and the practice workout that is never saved. The screens are stand-ins carrying the anchors. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../sheets.jsx', async () => {
  const { useStore } = await import('../store/useStore.js')
  return {
    beginWorkout: vi.fn(ids => useStore.getState().update(s => {
      s.active = { id: 'run-1', d: '2026-10-26', start: Date.now(), routineIds: ids, name: 'Practice run', cur: 0, entries: [] }
    })),
  }
})

import { useStore, DEF } from '../store/useStore.js'
import { beginWorkout } from '../sheets.jsx'
import { openTour, closeTour, tourState, readTour, noteStep, SAMPLE_ROUTINE_ID } from '../lib/tour.js'
import Tour, { _setAnchorWait } from './Tour.jsx'

const clone = o => JSON.parse(JSON.stringify(o))
const ANCHORS = ['today', 'start', 'plan-mode', 'plan-views', 'plan-menu', 'lib-search', 'lib-filters', 'set', 'tick', 'swipe', 'workout-more', 'finish', 'stats-tiles', 'settings-look', 'settings-units', 'settings-data']
let root, host, where, tapped
function Screens({ skip = [] }) {
  where = useLocation().pathname
  return <div>{ANCHORS.filter(a => !skip.includes(a)).map(a => <button key={a} data-tour={a} aria-label={'the ' + a} onClick={() => { tapped = a }}>{a}</button>)}</div>
}
const render = async (props = {}) => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/home']}><Screens {...props} /><Tour /></MemoryRouter>)
  })
  await settle()
}
const settle = async (ms = 150) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const card = () => document.querySelector('.tour-card')
const step = () => document.querySelector('.tour')?.getAttribute('data-step')
const btn = label => [...document.querySelectorAll('.tour-card button')].find(b => b.textContent === label)
const click = async el => { await act(async () => { el.click() }); await settle() }
const key = async (k, opts = {}) => { await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })) }); await settle(30) }

beforeEach(() => {
  localStorage.clear()
  _setAnchorWait(120)
  useStore.setState({ S: clone(DEF), user: null, ready: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  tapped = null
})
afterEach(async () => {
  await act(async () => { closeTour() })
  await act(async () => root.unmount())
  host.remove()
  useStore.getState().leaveTourSandbox()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the first-run question', () => {
  it('asks once: the card takes focus, Skip closes it and it is never asked again', async () => {
    await act(async () => { openTour({ kind: 'offer' }) })
    await render()
    expect(card().textContent).toContain('Want a 1-minute tour?')
    expect(document.activeElement).toBe(card())
    expect(readTour().offered).toBeGreaterThan(0)
    await click(btn('Skip'))
    expect(tourState()).toBe(null)
    expect(card()).toBe(null)
  })
  it('Show me starts the tour on Home, and Escape is a no as well', async () => {
    await act(async () => { openTour({ kind: 'offer' }) })
    await render()
    await click(btn('Show me'))
    expect(step()).toBe('today')
    expect(where).toBe('/home')
    await act(async () => { openTour({ kind: 'offer' }) })
    await settle()
    await key('Escape')
    expect(tourState()).toBe(null)
  })
  it('a tour closed halfway is picked up where it was, once', async () => {
    noteStep('lib-search')
    await act(async () => { openTour({ kind: 'resume', at: 'lib-search' }) })
    await render()
    expect(card().textContent).toContain('Finish the tour?')
    expect(readTour().resumeAsked).toBe(true)
    await click(btn('Continue'))
    expect(step()).toBe('lib-search')
    expect(where).toBe('/library')
  })
})

describe('the stops', () => {
  it('goes from stop to stop and screen to screen, back as well, with a counter', async () => {
    await act(async () => { openTour({ kind: 'run', at: null }) })
    await render()
    expect(step()).toBe('today')
    expect(card().textContent).toMatch(/Step 1 of \d+/)
    expect(btn('Back')).toBeUndefined()
    await click(btn('Next'))
    expect(step()).toBe('start')
    await click(btn('Next'))
    expect(step()).toBe('plan-mode')
    expect(where).toBe('/plan')
    await click(btn('Back'))
    expect(step()).toBe('start')
    expect(where).toBe('/home')
    expect(readTour().at).toBe('start')
  })
  it('describes the highlighted element for a screen reader and moves focus to the card each time', async () => {
    await act(async () => { openTour({ kind: 'run', at: 'plan-menu' }) })
    await render()
    expect(card().getAttribute('role')).toBe('dialog')
    expect(card().querySelector('.tour-sr').textContent).toContain('the plan-menu')
    expect(document.activeElement).toBe(card())
  })
  it('Tab stays inside the card, Escape ends the tour and marks it seen', async () => {
    await act(async () => { openTour({ kind: 'run', at: 'start' }) })
    await render()
    const buttons = [...card().querySelectorAll('button')]
    buttons.at(-1).focus()
    await key('Tab')
    expect(document.activeElement).toBe(buttons[0])
    await key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1))
    await key('Escape')
    expect(tourState()).toBe(null)
    expect(readTour().done).toBeGreaterThan(0)
    expect(readTour().at).toBe(null)
  })
  it('the dimmed screen takes the taps: the highlighted element is covered unless the stop asks for it', async () => {
    await act(async () => { openTour({ kind: 'run', at: 'start' }) })
    await render()
    // four panes around the hole plus one over it
    expect(document.querySelectorAll('.tour-block').length).toBe(5)
  })
  it('a missing optional stop is passed over in the direction of travel', async () => {
    useStore.setState({ S: { ...clone(DEF), restSec: 90 } })
    await act(async () => { openTour({ kind: 'run', at: 'tick' }) })
    await render()
    expect(step()).toBe('tick')
    await click(btn('Next'))   // no tick, so no rest timer: the rest stop has nothing to show
    await settle(300)
    expect(step()).toBe('swipe')
  })
  it('the closing card ends it and goes Home', async () => {
    await act(async () => { openTour({ kind: 'run', at: 'done' }) })
    await render()
    expect(card().textContent).toContain('The Coach, imports and your own server live in Settings.')
    expect(document.querySelector('.tour-hole')).toBe(null)
    await click(btn('Let’s go'))
    expect(tourState()).toBe(null)
    expect(where).toBe('/home')
  })
  it('with reduced motion the spotlight jumps instead of gliding', async () => {
    vi.stubGlobal('matchMedia', q => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    await act(async () => { openTour({ kind: 'run', at: 'start' }) })
    await render()
    expect(document.querySelector('.tour-hole').style.transition).toBe('none')
  })
})

describe('the practice workout', () => {
  it('runs on a sample session nothing saves, and is gone when the tour moves on', async () => {
    useStore.getState().update(s => { s.routines = [{ id: 'mine', name: 'Mine', ex: [] }] }, false)
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    await act(async () => { openTour({ kind: 'run', at: 'lib-filters' }) })
    await render()
    await click(btn('Next'))
    expect(step()).toBe('set')
    expect(beginWorkout).toHaveBeenCalledWith([SAMPLE_ROUTINE_ID], null)
    const st = useStore.getState()
    expect(st.tourSandbox).toBe(true)
    expect(st.S.active.tour).toBe(true)
    expect(st.S.routines.map(r => r.id)).toEqual(['mine', SAMPLE_ROUTINE_ID])
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    // Back to the Library: the sample is thrown away
    await click(btn('Back'))
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
  })
  it('tapping the tick goes on, and skipping mid-workout drops the sample and leaves the workout', async () => {
    await act(async () => { openTour({ kind: 'run', at: 'tick' }) })
    await render()
    expect(useStore.getState().tourSandbox).toBe(true)
    await act(async () => { document.querySelector('[data-tour="tick"]').click() })
    expect(tapped).toBe('tick')
    await settle(600)
    expect(step()).not.toBe('tick')
    await click(document.querySelector('.tour-skip'))
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S.active).toBeFalsy()
    expect(where).toBe('/home')
  })
})
