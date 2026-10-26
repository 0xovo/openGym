import { describe, expect, it } from 'vitest'
import { edgeOf, radiusAt } from './GymMap.jsx'
import { distanceM } from '../lib/gym-reminder.js'

// The radius handle on the map's circle (1.4.4): it sits on the edge due east of the pin, and
// dragging it reads the radius back in the slider's 10 m steps, kept between 50 and 500.
describe('the radius handle', () => {
  const c = { lat: 47.3769, lng: 8.5417 }
  it('sits on the circle, east of the pin', () => {
    const e = edgeOf(c, 150)
    expect(e.lat).toBe(c.lat)
    expect(e.lng).toBeGreaterThan(c.lng)
    expect(distanceM(c, e)).toBeCloseTo(150, -1)
  })
  it('dragged out or in: the radius in 10 m steps, within 50 to 500', () => {
    expect(radiusAt(c, edgeOf(c, 213), distanceM)).toBe(210)
    expect(radiusAt(c, edgeOf(c, 5), distanceM)).toBe(50)
    expect(radiusAt(c, edgeOf(c, 5000), distanceM)).toBe(500)
  })
})
