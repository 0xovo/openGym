// @vitest-environment happy-dom
// Halloween's moving parts (seasonal/halloween.jsx): the spider once a day at a start, the
// reduced-motion path, the workout screen, and the pumpkin's one surprise a day.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ui = vi.hoisted(() => ({ toast: null }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: ui.toast }) } }))
const buzz = vi.hoisted(() => ({ vibrate: null }))
vi.mock('../lib/sound.js', () => ({ vibrate: p => buzz.vibrate(p) }))

let host, root, reduce = false
// Each test gets the module afresh: the spider's and the witch's "this session" live in it.
const load = async () => { vi.resetModules(); return import('./halloween.jsx') }
beforeEach(() => {
  localStorage.clear()
  reduce = false
  window.matchMedia = q => ({ matches: reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
  ui.toast = vi.fn(); buzz.vibrate = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = el => act(() => root.render(el))

describe('the spider', () => {
  it('drops at the first start of the day, and not at the next one', async () => {
    let { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.hw-spider .hw-drop')).not.toBeNull()
    expect(host.querySelector('.hw-spider').getAttribute('aria-hidden')).toBe('true')
    act(() => root.unmount()); root = createRoot(host)
    ;({ Layer } = await load())                       // a second start, same day
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.hw-spider')).toBeNull()
  })

  it('does not drop over a start straight into a workout, and keeps the day for later', async () => {
    const { Layer } = await load()
    render(<Layer hidden fresh={false} />)
    expect(host.innerHTML).toBe('')
    expect(localStorage.getItem('og_season_spider')).toBeNull()
  })

  it('one tap and it scurries off, and is gone when it is out of sight', async () => {
    const { Layer } = await load()
    render(<Layer hidden={false} fresh />)
    act(() => { host.querySelector('.hw-spiderbtn').dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(host.querySelector('.hw-spider').classList.contains('hw-scurry')).toBe(true)
    act(() => {
      const e = new Event('animationend', { bubbles: true }); e.animationName = 'hw-scurry'
      host.querySelector('.hw-spiderbtn').dispatchEvent(e)
    })
    expect(host.querySelector('.hw-spider')).toBeNull()
  })

  it('with reduced motion: no drop, a still spider in the corner for a few seconds, no witch', async () => {
    reduce = true
    vi.useFakeTimers()
    const { Layer } = await load()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Layer hidden={false} fresh />)
    expect(host.querySelector('.hw-spider.hw-still')).not.toBeNull()
    expect(host.querySelector('.hw-drop, .hw-spiderbtn')).toBeNull()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(host.querySelector('.hw-spider')).toBeNull()
    act(() => { vi.advanceTimersByTime(120000) })
    expect(host.querySelector('.hw-witch')).toBeNull()
    random.mockRestore()
  })

  it('the witch flies at most once a session', async () => {
    vi.useFakeTimers()
    const { Layer } = await load()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(20001) })
    const w = host.querySelector('.hw-witch')
    expect(w).not.toBeNull()
    act(() => { w.dispatchEvent(new Event('animationend', { bubbles: true })) })
    render(<Layer hidden />)
    render(<Layer hidden={false} fresh={false} />)
    act(() => { vi.advanceTimersByTime(120000) })
    expect(host.querySelector('.hw-witch')).toBeNull()
    random.mockRestore()
  })
})

describe('the pumpkin', () => {
  it('peeks out of its card; one tap a day says boo, buzzes, and leaves the card alone', async () => {
    const { Deco } = await load()
    const card = vi.fn()
    render(<div onClick={card}><Deco spot="home-streak" /></div>)
    const btn = () => host.querySelector('.hw-pumpkin')
    expect(btn().getAttribute('aria-hidden')).toBe('true')
    act(() => btn().click())
    expect(card).not.toHaveBeenCalled()
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(ui.toast.mock.calls[0][0]).toMatch(/^Boo!/)
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.hw-burst')).not.toBeNull()
    act(() => btn().click())
    expect(ui.toast.mock.calls[1][0]).toBe('The pumpkin is napping. Come back tomorrow.')
    expect(buzz.vibrate).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion the surprise is the toast alone, no bats flying out', async () => {
    reduce = true
    const { Deco } = await load()
    render(<Deco spot="home-streak" />)
    act(() => host.querySelector('.hw-pumpkin').click())
    expect(ui.toast).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.hw-burst')).toBeNull()
  })
})

describe('the spots', () => {
  it('cobwebs and bats are decoration: hidden from assistive tech, never in a tap\'s way', async () => {
    const { Deco } = await load()
    render(<><Deco spot="home-hero" /><Deco spot="plan-card" /><Deco spot="header-bats" /><Deco spot="workout" /></>)
    const deco = [...host.children]
    expect(deco).toHaveLength(3)                      // an unknown spot draws nothing
    for (const el of deco) expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelectorAll('button')).toHaveLength(0)
  })
})
