// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { PhotoView, progressPhotosOf } from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* #558: a progress photo can be removed from the gallery's full-size view. It comes off the workout
   it belongs to and nothing else (the same photo on another workout stays), and Undo puts it back
   where it was. */
const ref = (n, extra = {}) => ({ kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 10, width: 4, height: 3, at: 1, ...extra })
const state = () => ({
  ...structuredClone(DEF),
  workouts: [
    { id: 'w1', d: '2026-10-01', start: 1, entries: [], media: [ref(1), ref(2), ref(3)] },
    { id: 'w2', d: '2026-10-05', start: 2, entries: [], media: [ref(2)] },
  ],
})

let host, root
beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: state(), user: null, ready: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll?.() })

const button = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)
const media = id => useStore.getState().S.workouts.find(w => w.id === id).media

describe('removing a progress photo', () => {
  it('asks first, takes it off that workout only, and Undo puts it back in its place', () => {
    const p = progressPhotosOf(useStore.getState().S).find(x => x.w.id === 'w1' && x.m.hash === ref(2).hash)
    let closed = 0
    act(() => root.render(<PhotoView p={p} close={() => { closed++ }} />))
    act(() => button('Remove').click())          // the trash in the bar
    expect(host.textContent).toContain('Remove this photo or video?')
    act(() => [...host.querySelectorAll('.mviewer-ask button')].find(b => b.textContent === 'Remove').click())
    expect(closed).toBe(1)
    expect(media('w1').map(m => m.hash)).toEqual([ref(1).hash, ref(3).hash])
    expect(media('w2').map(m => m.hash)).toEqual([ref(2).hash])
    const ui = useUI.getState()
    expect(ui.toastMsg).toBe('Photo removed')
    expect(ui.toastAction?.label).toBe('Undo')
    act(() => ui.runToastAction())
    expect(media('w1')).toEqual([ref(1), ref(2), ref(3)])
  })

  it('Cancel leaves it as it was', () => {
    const before = structuredClone(useStore.getState().S.workouts)
    const p = progressPhotosOf(useStore.getState().S)[0]
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Remove').click())
    act(() => button('Cancel').click())
    expect(useStore.getState().S.workouts).toEqual(before)
  })
})
