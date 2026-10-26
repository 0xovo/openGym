// The gym reminder's map (#614, redrawn in 1.4.4): OpenStreetMap tiles through Leaflet, loaded
// only when the editor opens (and only in the phone app; the web build never has the page). Tap
// the map or drag the pin; the accent circle is the radius, and the round handle on its edge
// drags it bigger or smaller. Dark mode darkens the tiles in CSS (index.css .gym-map).
import { useEffect, useRef } from 'react'
import { TILES } from '../lib/gym-places.js'
import { RADIUS, clampRadius } from '../lib/gym-reminder.js'

// The point on the circle's edge due east of the centre, where the handle sits.
export const edgeOf = (c, r) => ({ lat: c.lat, lng: c.lng + r / (111320 * Math.cos(c.lat * Math.PI / 180)) })
// A handle dragged to `p`: the radius it means, on the slider's 10 m steps.
export const radiusAt = (c, p, dist) => clampRadius(Math.round(dist(c, p) / RADIUS.step) * RADIUS.step)

export default function GymMap({ pos, radius, onPick, onRadius, label, handleLabel }) {
  const host = useRef(null)
  const live = useRef(null)
  const cb = useRef({ onPick, onRadius })
  cb.current = { onPick, onRadius }
  const rNow = useRef(radius)
  rNow.current = radius
  useEffect(() => {
    let gone = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      const L = mod.default || mod
      if (gone || !host.current) return
      const start = pos || { lat: 20, lng: 0 }
      const map = L.map(host.current, { zoomControl: false, attributionControl: true }).setView([start.lat, start.lng], pos ? 17 : 2)
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>')
      L.control.zoom({ position: 'bottomleft' }).addTo(map)
      L.tileLayer(TILES.url, { maxZoom: TILES.maxZoom, attribution: TILES.attribution, className: 'gym-tiles' }).addTo(map)
      const icon = L.divIcon({ className: 'gym-pin', html: '<span></span>', iconSize: [34, 34], iconAnchor: [17, 34] })
      const knob = L.divIcon({ className: 'gym-handle', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 14] })
      const shown = !!pos
      const marker = L.marker([start.lat, start.lng], { draggable: true, icon, title: label, alt: label, opacity: shown ? 1 : 0, keyboard: true }).addTo(map)
      const circle = L.circle([start.lat, start.lng], { radius, className: 'gym-radius', interactive: false, opacity: shown ? 1 : 0, fillOpacity: shown ? 0.16 : 0 }).addTo(map)
      const e0 = edgeOf(start, radius)
      const handle = L.marker([e0.lat, e0.lng], { draggable: true, icon: knob, title: handleLabel, alt: handleLabel, opacity: shown ? 1 : 0, keyboard: false }).addTo(map)
      const dist = (a, b) => map.distance([a.lat, a.lng], [b.lat, b.lng])
      const centre = () => { const ll = marker.getLatLng(); return { lat: ll.lat, lng: ll.lng } }
      const placeHandle = () => { const e = edgeOf(centre(), rNow.current); handle.setLatLng([e.lat, e.lng]) }
      const show = () => { marker.setOpacity(1); handle.setOpacity(1); circle.setStyle({ opacity: 1, fillOpacity: 0.16 }) }
      const moveTo = ll => {
        marker.setLatLng(ll); circle.setLatLng(ll); show(); placeHandle()
        cb.current.onPick({ lat: ll.lat, lng: ll.lng })
      }
      marker.on('drag', e => { circle.setLatLng(e.target.getLatLng()); placeHandle() })
      marker.on('dragend', e => moveTo(e.target.getLatLng()))
      handle.on('drag', e => {
        const r = radiusAt(centre(), e.target.getLatLng(), dist)
        circle.setRadius(r)
        if (r !== rNow.current) cb.current.onRadius?.(r)
      })
      // Let go: the handle snaps back onto the edge (it may have been dragged off to the side).
      handle.on('dragend', () => placeHandle())
      map.on('click', e => moveTo(e.latlng))
      // The whole circle in view, with room for the search on top: a phone at 320 px included.
      const frame = () => map.fitBounds(circle.getBounds(), { padding: [44, 44], maxZoom: 18, animate: false })
      if (shown) frame()
      live.current = { map, marker, circle, handle, placeHandle, show, frame }
      // The page may still be sliding in: measure once it sits.
      setTimeout(() => { if (!gone) { map.invalidateSize(); if (marker.options.opacity === 1) frame() } }, 350)
    }).catch(() => {})
    return () => { gone = true; live.current?.map.remove(); live.current = null }
  }, [])
  // A new place from outside (a search result, "I'm here right now"): the pin and the view follow.
  useEffect(() => {
    const m = live.current
    if (!m || !pos) return
    const cur = m.marker.getLatLng()
    if (Math.abs(cur.lat - pos.lat) < 1e-7 && Math.abs(cur.lng - pos.lng) < 1e-7 && m.marker.options.opacity === 1) return
    m.marker.setLatLng([pos.lat, pos.lng]); m.circle.setLatLng([pos.lat, pos.lng])
    m.show(); m.placeHandle()
    m.frame()
  }, [pos?.lat, pos?.lng])
  useEffect(() => { const m = live.current; if (m) { m.circle.setRadius(radius); m.placeHandle() } }, [radius])
  return <div className="gym-map" ref={host} role="application" aria-label={label} />
}
