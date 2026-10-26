// The app tour: coach marks on the real screens (lib/tour.js has the steps and the record). Its
// own chunk, loaded by App only while the tour or its question is open, so a normal start pays
// nothing for it.
//
// A spotlight is cut out over one element (data-tour="..."), the rest of the screen is dimmed and
// does not take taps, and a small card says what it is. The workout stops run on a sample session
// in the store's sandbox (useStore enterTourSandbox): it is never saved or synced and is gone the
// moment the tour leaves the workout, finished, skipped or closed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { workoutControls } from '../lib/workout-controls.js'
import {
  useTour, tourSteps, stepFrom, indexOfStep, noteStep, markTourDone, markOffered, markResumeAsked,
  openTour, closeTour, placeCard, SAMPLE_ROUTINE_ID,
} from '../lib/tour.js'
import { beginWorkout } from '../sheets.jsx'
import { Button } from './ui.jsx'
import './Tour.css'

// What each stop says. Literal t() calls, so check-source-strings sees every one.
const COPY = {
  today: () => [t('Today at a glance'), t('Today’s session lives here. One tap and you’re lifting. On a rest day it says so, no guilt trip.')],
  start: () => [t('The big Start button'), t('Always here. It starts today’s plan, or lets you pick something else.')],
  'plan-mode': () => [t('Week or rotation'), t('Train on fixed weekdays, or run your routines in a loop where the next one waits for you.')],
  'plan-views': () => [t('Your routines'), t('Schedule says when, Routines says what. Build your own or grab a starter plan.')],
  'plan-body': () => [t('Muscles at a glance'), t('The little body shows what each day works, so leg day can’t hide.')],
  'plan-menu': () => [t('Programmes and sharing'), t('Programmes, starter plans and sharing a plan with a friend live behind this button.')],
  'lib-search': () => [t('Find any exercise'), t('Search thousands of exercises in your language. Star your favourites and they float to the top.')],
  'lib-filters': () => [t('Filter it down'), t('Narrow the list by body part, type or the equipment you have.')],
  set: () => [t('A practice workout'), t('This one is pretend, nothing gets saved. Each row is a set: weight, then reps. Tap a number to change it.')],
  tick: () => [t('Tick it off'), t('Done with a set? Tick it. Go on, try it.')],
  rest: () => [t('Catch your breath'), t('The rest timer starts by itself. Add time, or skip it if you feel heroic.')],
  swipe: () => [t('Swipe a set'), t('Swipe a set sideways to copy or remove it. Its number opens even more.')],
  more: () => [t('The ⋯ menu'), t('Workout settings, layouts, notes and extra exercises hide in here.')],
  finish: () => [t('Finish line'), t('Finish saves the session and moves your weights along. This practice one just quietly disappears.')],
  stats: () => [t('Your progress'), t('Workouts, streaks and everything you’ve lifted. It fills up as you train.')],
  'stats-body': () => [t('Body map'), t('See which muscles got the work and which still need rest. Tap one for details.')],
  'stats-records': () => [t('Records'), t('Pick an exercise to see its best sets, estimated max and where it’s heading.')],
  look: () => [t('Make it yours'), t('Theme, accent colour and what Home shows.')],
  units: () => [t('Units & language'), t('Kilos or pounds, and the language you like best.')],
  data: () => [t('Your data, your backups'), t('Backups, imports and syncing with your own server.')],
  done: () => [t('You’re set'), t('The Coach, imports and your own server live in Settings. Have a great first workout!')],
}

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The element a stop points at: the first one on screen, not one in the page an edge swipe back
    shows underneath or a card preview (both inert). */
export function findAnchor(name) {
  if (!name) return null
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) {
    if (el.closest('[inert]') || el.closest('.page.under') || el.closest('[hidden]')) continue
    return el
  }
  return null
}

// What a screen reader hears the spotlight is on: the element's own name, kept short.
const nameOf = el => {
  if (!el) return ''
  const own = el.getAttribute('aria-label') || el.querySelector?.('[aria-label]')?.getAttribute('aria-label') || el.textContent || ''
  const s = own.replace(/\s+/g, ' ').trim()
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

// Which optional stops this profile gets (lib/tour.js tourSteps).
const ctxOf = S => ({
  plannedDays: scheduleModeOf(S) !== 'rotation' && Object.values(S.week || {}).some(v => [].concat(v || []).some(id => S.routines.some(r => r.id === id))),
  rest: (S.restSec ?? 90) > 0,
  swipe: !!workoutControls(S).swipeSets && (S.workoutView || 'cards') !== 'focus',
  balance: S.workouts.length > 0 || S.routines.some(r => r.ex?.length),
  workouts: S.workouts.length > 0,
})

// The sample session: a routine of two classics, only ever inside the sandbox.
const sampleRoutine = S => ({
  id: SAMPLE_ROUTINE_ID, name: t('Practice run'), emoji: 'barbell',
  ex: [
    { id: '0025', sets: 3, reps: 8, weight: S.unit === 'lb' ? 45 : 20 },
    { id: '0043', sets: 3, reps: 8, weight: S.unit === 'lb' ? 95 : 40 },
  ],
})
export function startPractice() {
  const st = useStore.getState()
  if (st.tourSandbox) return
  st.enterTourSandbox(s => {
    s.routines = [...s.routines, sampleRoutine(s)]
    s.active = null
  })
  beginWorkout([SAMPLE_ROUTINE_ID], null)
  const S = useStore.getState().S
  if (S.active) useStore.getState().update(s => { if (s.active) s.active.tour = true })
}
export function endPractice() {
  if (!useStore.getState().tourSandbox) return
  const ui = useUI.getState()
  ui.stopRest()
  ui.stopWork?.()
  useStore.getState().leaveTourSandbox()
}

// The insets the phone keeps for itself (index.css --sat/--sab), read once through a probe.
function safeInsets() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:var(--sat,0px);padding-bottom:var(--sab,0px)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }
  probe.remove()
  return out
}

// Tab stays inside the card; Escape closes. Shared by the run and the two questions.
function useCardKeys(cardRef, onEscape) {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); return }
      if (e.key !== 'Tab' || !cardRef.current) return
      const f = [...cardRef.current.querySelectorAll('button:not([disabled])')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      const inside = cardRef.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onEscape])
}

/* "Want a 1-minute tour?" after the first setup, or "Finish the tour?" once after it was closed
   halfway. A small card in the middle; either answer is remembered. */
function Question({ kind, at }) {
  const cardRef = useRef(null)
  const resume = kind === 'resume'
  useEffect(() => { if (resume) markResumeAsked(); else markOffered() }, [resume])
  useEffect(() => { cardRef.current?.focus() }, [])
  const no = () => { if (resume) markTourDone(); closeTour() }
  const yes = () => openTour({ kind: 'run', at: resume ? at : null })
  useCardKeys(cardRef, no)
  return <div className="tour tour-ask">
    <div className="tour-block tour-dim" />
    <div className="tour-card tour-center" ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b">
      <h2 id="tour-t">{resume ? t('Finish the tour?') : t('Want a 1-minute tour?')}</h2>
      <p id="tour-b">{resume ? t('You stopped halfway. Want to see the rest?') : t('We’ll point at the good bits on the real screens. Bail out anytime.')}</p>
      <div className="tour-acts">
        <Button onClick={no}>{resume ? t('No thanks') : t('Skip')}</Button>
        <Button variant="primary" onClick={yes}>{resume ? t('Continue') : t('Show me')}</Button>
      </div>
    </div>
  </div>
}

function Run({ at }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S0 = useRef(useStore.getState().S).current
  const steps = useMemo(() => tourSteps(ctxOf(S0)), [S0])
  const [i, setI] = useState(() => indexOfStep(steps, at))
  const [rect, setRect] = useState(null)
  const [ready, setReady] = useState(false)
  const [card, setCard] = useState({ w: 320, h: 180 })
  const cardRef = useRef(null)
  const anchorRef = useRef(null)
  const dirRef = useRef(1)
  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname
  const insets = useMemo(() => safeInsets(), [])
  const reduced = useMemo(reducedMotion, [])
  const step = steps[i]
  const [title, body] = (COPY[step.id] || (() => [step.id, '']))()

  const finish = () => {
    markTourDone()
    endPractice()
    closeTour()
    if (pathRef.current === '/workout' || step.id === 'done') nav('/home', { replace: true })
  }
  const go = dir => {
    dirRef.current = dir
    const j = stepFrom(steps, i, dir)
    if (j < 0) { if (dir > 0) finish(); return }
    setI(j)
  }

  // Each stop: the right screen (and the practice session for the workout ones), then the element.
  useEffect(() => {
    let gone = false, tm = null
    setReady(false)
    setRect(null)
    anchorRef.current = null
    noteStep(step.id)
    if (step.practice) startPractice()
    else endPractice()
    if (pathRef.current !== step.route) nav(step.route, { replace: true })
    const started = Date.now()
    const look = () => {
      if (gone) return
      const el = findAnchor(step.anchor)
      if (!el && step.anchor && Date.now() - started < 2000) { tm = setTimeout(look, 60); return }
      // Not there after all: an optional stop is passed over, any other one speaks from the middle.
      if (!el && step.anchor && step.optional) { go(dirRef.current); return }
      anchorRef.current = el
      if (el) {
        const r = el.getBoundingClientRect()
        const vh = window.innerHeight
        if (r.top < insets.top + 60 || r.bottom > vh - insets.bottom - 90) el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      }
      setReady(true)
    }
    look()
    return () => { gone = true; clearTimeout(tm) }
  }, [i])

  // The spotlight follows its element: a scroll, a keyboard, a card that grows.
  useEffect(() => {
    if (!ready) return
    let raf = 0, last = ''
    const tick = () => {
      const el = anchorRef.current
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect()
        const key = [r.top, r.left, r.width, r.height].map(Math.round).join(',')
        if (key !== last) { last = key; setRect({ top: r.top, left: r.left, width: r.width, height: r.height }) }
      } else if (el) {
        // Re-rendered under us (a set ticked rebuilds its row): the same anchor again.
        anchorRef.current = findAnchor(step.anchor)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [ready, i])

  // The card reads first: focus goes to it at every stop.
  useEffect(() => { if (ready) cardRef.current?.focus({ preventScroll: true }) }, [ready, i])
  useLayoutEffect(() => {
    const el = cardRef.current
    if (el && (el.offsetWidth !== card.w || el.offsetHeight !== card.h) && el.offsetWidth) setCard({ w: el.offsetWidth, h: el.offsetHeight })
  })

  // Tapping the highlighted element is a way on where the stop says so (the set's tick): the
  // app does what the tap does first, and the tour follows.
  useEffect(() => {
    if (!ready || !step.tap) return
    let tm = null
    const onClick = e => { if (anchorRef.current?.contains(e.target)) tm = setTimeout(() => go(1), 350) }
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('click', onClick); clearTimeout(tm) }
  }, [ready, i])

  // The browser's back closes the tour; so does leaving it mounted (an error, a sign-out).
  useEffect(() => {
    const onPop = () => { markTourDone(); endPractice(); closeTour() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => () => endPractice(), [])
  useCardKeys(cardRef, finish)

  const pad = 6
  const hole = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
  const vw = window.innerWidth, vh = window.innerHeight
  const pos = placeCard(hole, card, { vw, vh, top: insets.top, bottom: insets.bottom })
  const motion = reduced ? 'none' : undefined
  const open = step.tap || step.interact
  const last = i === steps.length - 1
  const what = nameOf(anchorRef.current)

  return <div className="tour" data-step={step.id}>
    {hole ? <>
      <div className="tour-hole" data-testid="tour-hole" style={{ ...hole, transition: motion }} />
      {/* Four panes around the hole take the taps the dimmed screen should not get. */}
      <div className="tour-block" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className="tour-block" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-block" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="tour-block" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
      {!open && <div className="tour-block" style={hole} />}
    </> : <div className="tour-block tour-dim" />}
    <div className={'tour-card' + (hole ? '' : ' tour-center')} ref={cardRef} tabIndex={-1}
      role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b"
      style={hole ? { top: pos.top, left: pos.left, transition: motion } : undefined}>
      <div className="tour-top">
        <span className="tour-count">{t('Step {0} of {1}', i + 1, steps.length)}</span>
        {!last && <button type="button" className="tour-skip" onClick={finish}>{t('Skip tour')}</button>}
      </div>
      <h2 id="tour-t">{title}</h2>
      <p id="tour-b">{body}{what && <span className="tour-sr"> {t('Pointing at: {0}', what)}</span>}</p>
      <div className="tour-acts">
        {i > 0 && <Button onClick={() => go(-1)}>{t('Back')}</Button>}
        <Button variant="primary" onClick={() => go(1)}>{last ? t('Let’s go') : t('Next')}</Button>
      </div>
    </div>
  </div>
}

export default function Tour() {
  const st = useTour()
  if (!st) return null
  if (st.kind === 'run') return <Run key="run" at={st.at} />
  return <Question kind={st.kind} at={st.at} />
}
