import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { vibrate } from '../lib/sound.js'
import { onceToday, doneToday, reducedMotion } from '../lib/seasonal.js'
import './halloween.css'

/* Halloween (v1.4.3), fetched only while the theme shows (components/Seasonal.jsx). All of it is
   hand-drawn inline SVG, moved with CSS transforms and opacity only: no rAF loop, nothing that
   lays the page out again, and every animation has an end. Everything is aria-hidden and lets
   taps through, except the spider and the pumpkin, which are the point. Never on the workout
   screen: App.jsx hides the layer there, and no workout view has a spot. */

/* ---------------------------------------------------------------- art -- */

// A corner web: spokes out of the corner and sagging threads between them, drawn once.
const WEB = (() => {
  const spokes = [3, 22, 44, 66, 87].map(a => (a * Math.PI) / 180)
  const rings = [9, 19, 30, 42, 53]
  const pt = (r, a) => [r * Math.cos(a), r * Math.sin(a)].map(v => v.toFixed(1)).join(' ')
  let d = spokes.map(a => `M0 0L${pt(58, a)}`).join('')
  rings.forEach((r, i) => {
    for (let s = 0; s < spokes.length - 1; s++) {
      const a = spokes[s], b = spokes[s + 1]
      // A little unevenness, so it reads as spun rather than plotted.
      const sag = 0.78 + ((i + s) % 3) * 0.04
      d += `M${pt(r, a)}Q${pt(r * sag, (a + b) / 2)} ${pt(r, b)}`
    }
  })
  return d
})()

// A bat, drawn as its right half and mirrored, so both wings always match.
const BAT = (() => {
  const R = [['M', [16, 5.6]], ['L', [16.9, 3.5]], ['L', [17.5, 5.3]], ['Q', [21, 2.3], [25.5, 2.6]], ['Q', [29.6, 3], [31.6, 6.2]],
    ['Q', [29.2, 5.7], [27.6, 7.7]], ['Q', [25.4, 6.6], [23.8, 8.5]], ['Q', [21.6, 7.8], [20.4, 10.1]], ['Q', [18.6, 9.9], [17.5, 11.5]], ['Q', [16.8, 12.7], [16, 13.8]]]
  const m = ([x, y]) => `${(32 - x).toFixed(1)} ${y}`
  const f = ([x, y]) => `${x} ${y}`
  let d = R.map(([c, a, b]) => c + f(a) + (b ? ' ' + f(b) : '')).join('')
  for (let i = R.length - 1; i > 0; i--) {
    const [c, a, b] = R[i], from = R[i - 1][2] || R[i - 1][1]
    d += c === 'Q' ? `Q${m(a)} ${m(from)}` : `L${m(from)}`
  }
  return d + 'Z'
})()

const Bat = ({ className = '' }) => (
  <svg className={'hw-batsvg ' + className} viewBox="0 0 32 16" aria-hidden="true" focusable="false"><path d={BAT} /></svg>
)

const Web = ({ className = '' }) => (
  <svg className={'hw-web ' + className} viewBox="0 0 60 60" aria-hidden="true" focusable="false"><path d={WEB} /></svg>
)

const Spider = () => (
  <svg className="hw-spidersvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g className="hw-legs hw-legs-l">
      <path d="M9 11.6 5.6 8.2 3.4 9.6M8.4 13.6 4.4 12.2 2.4 14.2M8.6 15.6 4.8 16.8 3.4 19.2M9.4 17.4 7 20.2 6.6 22.6" />
    </g>
    <g className="hw-legs hw-legs-r">
      <path d="M15 11.6l3.4-3.4 2.2 1.4M15.6 13.6l4-1.4 2 2M15.4 15.6l3.8 1.2 1.4 2.4M14.6 17.4l2.4 2.8.4 2.4" />
    </g>
    <ellipse className="hw-body" cx="12" cy="14.6" rx="3.9" ry="4.4" />
    <circle className="hw-body" cx="12" cy="9.4" r="2.6" />
    <circle className="hw-eye" cx="11" cy="9.2" r=".75" /><circle className="hw-eye" cx="13" cy="9.2" r=".75" />
  </svg>
)

const Pumpkin = () => (
  <svg className="hw-pumpkinsvg" viewBox="0 0 48 38" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="hw-pk" cx="45%" cy="40%" r="65%">
        <stop offset="0" stopColor="#ffab4a" /><stop offset="1" stopColor="#e2600d" />
      </radialGradient>
    </defs>
    <path className="hw-stem" d="M22.2 8.6c-.3-3.6 1.1-6.2 4.2-7.4l1.2 1.9c-2 .9-2.7 2.8-2.4 5.5Z" />
    <path className="hw-vine" d="M26 6.4c2.4-1.6 5-.9 5.6 1.2-1.9-.8-3.7-.6-5.2.7" />
    <g fill="url(#hw-pk)" className="hw-lobes">
      <ellipse cx="11" cy="23" rx="8.6" ry="11.6" />
      <ellipse cx="37" cy="23" rx="8.6" ry="11.6" />
      <ellipse cx="16.5" cy="22.4" rx="9.6" ry="13.2" />
      <ellipse cx="31.5" cy="22.4" rx="9.6" ry="13.2" />
      <ellipse cx="24" cy="22" rx="9.4" ry="14" />
    </g>
    <g className="hw-face">
      <path className="hw-eyes" d="M13.4 18.2h6.4l-3.1-5.4ZM28.2 18.2h6.4l-3.3-5.4Z" />
      <path d="M22.5 22.4h3L24 19.9Z" />
      <path d="M12.6 24.6Q24 31 35.4 24.6l-1.9 4.1-2.4-1.3-2 3-2.5-1.9-2.6 3-2.6-3-2.5 1.9-2-3-2.4 1.3Z" />
    </g>
  </svg>
)

const Witch = () => (
  <svg className="hw-witchsvg" viewBox="0 -3 80 46" aria-hidden="true" focusable="false">
    <path d="M7 34.2 74 25.6l.3 2.2L7.4 36.4Z" />
    <path d="M1.4 29.6c4.6.3 8.6 1.6 12.6 3.4l.6 3.6c-4.2 1.8-8.4 3-13.4 3.4 2.4-2.2 3.4-4.2 2.6-6.4-.4-1.6-1.2-2.8-2.4-4Z" />
    <path d="M35.6 18.2c-7.4 1.4-12.6 5.6-16 10.6 4.2-1.6 8.6-2 13-1.4Z" />
    <path d="M34.4 30.2c-3.4-5.8-2-11.8 2.6-15.4 3.2-2.4 7.4-2.4 10 .4 2.8 3 2.4 7.6.8 11.2l3.8 2.4Z" />
    <path d="M45.4 26.2 53.6 31h3.4l-.4 2.2h-4.4l-8.6-4.6Z" />
    <circle cx="46.8" cy="11.4" r="3.6" />
    <path d="M50 10.8l3.8 1.6-3.6.6Z" />
    <path d="M38.8 8.4h15.2c.6 0 .6 1.2 0 1.2H38.8c-.6 0-.6-1.2 0-1.2Z" />
    <path d="M42.4 8.6h7.4C48 4.6 45 1 40 -1.6c2.6 3 3.4 6 2.4 10.2Z" />
  </svg>
)

/* -------------------------------------------------------- the layer -- */

// Once per session at most, decided once: the witch is rare on purpose.
let witchPlan = null
let witchFlown = false
let spiderTried = false

/** The spider at the day's first start, and now and then the witch. Nothing while `hidden`. */
export function Layer({ hidden, fresh }) {
  const [spider, setSpider] = useState(null)   // null | 'drop' | 'still'
  const [witch, setWitch] = useState(false)
  useEffect(() => {
    if (spiderTried || hidden) return
    spiderTried = true
    // A start straight into a workout, or a day it already dropped on this device: no spider.
    if (!fresh || !onceToday('spider')) return
    const still = reducedMotion()
    setSpider(still ? 'still' : 'drop')
    // Reduced motion: a tiny spider sits in the corner for a few seconds, and that is all.
    if (still) { const tm = setTimeout(() => setSpider(null), 4000); return () => clearTimeout(tm) }
  }, [hidden, fresh])
  useEffect(() => {
    if (hidden || witchFlown || reducedMotion()) return
    if (witchPlan === null) witchPlan = Math.random() < 0.4 ? 20000 + Math.random() * 60000 : false
    if (!witchPlan) return
    const tm = setTimeout(() => { witchFlown = true; setWitch(true) }, witchPlan)
    return () => clearTimeout(tm)
  }, [hidden])
  if (hidden) return null
  return <>
    {spider && <SpiderDrop still={spider === 'still'} onGone={() => setSpider(null)} />}
    {witch && <div className="hw-witch" aria-hidden="true" onAnimationEnd={() => setWitch(false)}><Witch /></div>}
  </>
}

function SpiderDrop({ still, onGone }) {
  const [scurry, setScurry] = useState(false)
  if (still) return <div className="hw-spider hw-still" aria-hidden="true"><Spider /></div>
  // The outer element swings on its thread (a damped pendulum), the inner one drops and climbs.
  return <div className={'hw-spider' + (scurry ? ' hw-scurry' : '')} aria-hidden="true"
    onAnimationEnd={e => { if (e.animationName === 'hw-scurry' && e.target.classList.contains('hw-spiderbtn')) onGone() }}>
    <div className="hw-drop" onAnimationEnd={e => { if (e.target === e.currentTarget) onGone() }}>
      <span className="hw-thread" />
      <button type="button" className="hw-spiderbtn" tabIndex={-1} aria-hidden="true"
        onPointerDown={e => { e.stopPropagation(); setScurry(true) }}><Spider /></button>
    </div>
  </div>
}

/* ----------------------------------------------------- the spots -- */

/** Decoration for one place in a view. Unknown spots draw nothing. */
export function Deco({ spot }) {
  if (spot === 'home-bats') return <HeaderBats />
  if (spot === 'home-hero') return <Web className="hw-web-br" />
  if (spot === 'plan-card') return <Web className="hw-web-tr" />
  if (spot === 'home-streak') return <PeekPumpkin />
  return null
}

// Three bats cross behind the title a few times, then the sky stays quiet until the next visit.
function HeaderBats() {
  const still = reducedMotion()
  return <div className={'hw-bats' + (still ? ' hw-bats-still' : '')} aria-hidden="true">
    {[0, 1, 2].map(i => <span key={i} className={'hw-batlane hw-lane' + i}><span className="hw-flap"><Bat /></span></span>)}
  </div>
}

// Said when the pumpkin is found: one a day, the same one all day.
const BOOS = [
  'Boo! You found the pumpkin. It was watching you train.',
  'Boo! Pumpkin found. Your next PR is now officially haunted.',
  'Boo! The bats were not part of the warm-up.',
  'Boo! Found it. The spiders owe you a rep.',
]

function PeekPumpkin() {
  const ref = useRef(null)
  const [burst, setBurst] = useState(null)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (!burst) return
    const tm = setTimeout(() => setBurst(null), 1400)
    return () => clearTimeout(tm)
  }, [burst])
  const tap = e => {
    // The card it hides behind opens the calendar; the pumpkin is its own thing.
    e.stopPropagation()
    const toast = useUI.getState().toast
    setHop(h => h + 1)
    if (!doneToday('pumpkin') && onceToday('pumpkin')) {
      const r = ref.current?.getBoundingClientRect()
      if (r && !reducedMotion()) setBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      // A "boo": two short taps and a longer one, on whatever this device can buzz.
      vibrate([25, 50, 60])
      toast(t(BOOS[new Date().getDate() % BOOS.length]))
    } else toast(t('The pumpkin is napping. Come back tomorrow.'))
  }
  return <>
    <span className="hw-peek" aria-hidden="true">
      <button type="button" ref={ref} key={hop} className={'hw-pumpkin' + (hop ? ' hw-hop' : '')} tabIndex={-1} aria-hidden="true"
        onClick={tap} onKeyDown={e => e.stopPropagation()}><Pumpkin /></button>
    </span>
    {burst && <div className="hw-burst" aria-hidden="true" style={{ left: burst.x, top: burst.y }}>
      {BURST.map(([dx, dy, r], i) => <span key={i} className="hw-burstbat" style={{ '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', animationDelay: i * 35 + 'ms' }}><Bat /></span>)}
    </div>}
  </>
}
// Where each bat of the burst ends up, relative to the pumpkin: mostly up and out.
const BURST = [[-120, -150, -18], [-60, -210, -8], [10, -240, 4], [80, -190, 12], [140, -120, 20], [-150, -60, -24], [160, -40, 26]]
