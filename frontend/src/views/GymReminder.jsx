// Settings → Reminders → Gym reminder (#614), phone app only: the gyms that get you a nudge when
// you walk in, and the editor for one of them. Redrawn in 1.4.4 to look like the rest of the app:
// the gyms are cards like Plan's routines (swipe or ⋯ to rename or remove, a switch each), and the
// editor is a big map with a search on top. On the iPhone the place is picked on Apple Maps (the
// native picker, lib/gym-places.js pickOnNativeMap); elsewhere, or on an iPhone build without it,
// on OpenStreetMap (components/GymMap.jsx).
// What is kept and how the phone watches it: lib/gym-reminder.js.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { Section, Row, Switch, Slider, TextField, SearchField, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import GymMap from '../components/GymMap.jsx'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import { platformNow } from '../lib/platform-now.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { workoutControls } from '../lib/workout-controls.js'
import { searchPlaces, googleMapsUrl, hasNativePicker, pickOnNativeMap, accentHex } from '../lib/gym-places.js'
import {
  RADIUS, MAX_GYMS, DEFAULT_WINDOW, normConfig, normGym, statusOf,
  loadGymConfig, saveGymConfig, gymPermissions, askForegroundLocation, askBackgroundLocation,
  currentPosition, openAppSettings,
} from '../lib/gym-reminder.js'

const ios = () => platformNow() === 'ios'

// The one place a permission is explained before the system asks for it.
const explainAlways = () => new Promise(resolve => confirmSheet({
  title: ios() ? t('Allow location “Always”?') : t('Allow location “All the time”?'),
  message: <>
    <p>{t('To notice that you walked into your gym while openGym is closed, the phone needs to let it see your location in the background.')}</p>
    <p style={{ marginTop: 8 }}>{t('The phone itself watches the gyms you added and only wakes openGym when you arrive. No tracking in between, and your locations never leave this phone.')}</p>
    {!ios() && <p style={{ marginTop: 8 }}>{t('On the next screen, pick “Allow all the time”.')}</p>}
  </>,
  confirmText: t('Continue'),
  cancelText: t('Not now'),
  onConfirm: () => resolve(true),
  onCancel: () => resolve(false),
}))

const permLabel = p => !p ? '' : p.background === 'granted' ? (ios() ? t('Always') : t('All the time'))
  : p.location === 'granted' ? t('Only while using the app') : p.location === 'denied' ? t('Not allowed') : t('Not asked yet')

const noLocation = () => t('Location isn’t allowed for openGym. You can change that in the phone’s settings.')

// While-using location, asked for if it has not been yet. True when the phone may locate.
async function mayLocate() {
  let p = await gymPermissions()
  if (p?.location !== 'granted') p = await askForegroundLocation()
  return p?.location === 'granted'
}

/**
 * The Apple Maps picker, in the app's colours and words. Resolves like pickOnNativeMap: a place,
 * null when backed out, undefined when this phone has no native picker (the web map then).
 */
async function pickNative(gym) {
  if (!(await hasNativePicker())) return undefined
  // The map starts where you are when it may; it still works without (search, drag the pin).
  const p = await gymPermissions()
  if (p?.location === 'prompt') await askForegroundLocation()
  const has = Number.isFinite(gym?.lat) && Number.isFinite(gym?.lng)
  return pickOnNativeMap({
    ...(has ? { lat: gym.lat, lng: gym.lng } : {}),
    name: gym?.name || '', radius: gym?.radius || RADIUS.def,
    min: RADIUS.min, max: RADIUS.max, step: RADIUS.step,
    tint: accentHex(), dark: document.documentElement.dataset.theme !== 'light',
    strings: {
      title: t('Your gym'), search: t('Find your gym…'), here: t('I’m here right now'),
      done: t('Use this place'), cancel: t('Cancel'), radius: t('{0} m around the pin'),
      none: t('Nothing found. Try a street and a town.'),
      hint: t('Tap the map or drag the pin onto your gym.'),
      privacy: t('Searches go to Apple Maps. Your gyms stay on this phone.'),
    },
  })
}

// Rename, from the ⋯ menu: a small sheet with one field.
function RenameGym({ name, onSave, close }) {
  const [v, setV] = useState(name || '')
  const save = () => { onSave(v.trim().slice(0, 60)); close() }
  return <>
    <h3>{t('Rename gym')}</h3>
    <TextField value={v} maxLength={60} autoFocus placeholder={t('My gym')} aria-label={t('Name')}
      onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export default function GymReminderPage() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const swipe = useStore(s => workoutControls(s.S).swipeSets)
  const [config, setConfig] = useState(null)
  const [perm, setPerm] = useState(null)
  const [busy, setBusy] = useState(false)
  // The latest list, for an Undo that runs after other changes.
  const latest = useRef(null)
  latest.current = config
  useEffect(() => {
    let gone = false
    loadGymConfig().then(r => { if (!gone) { setConfig(r.config); setPerm(r.permission) } })
    return () => { gone = true }
  }, [])
  // Back from the system settings: the answer may have changed there.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') gymPermissions().then(p => p && setPerm(p)) }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [])
  if (!config) return <Section><Row icon="mapPin" iconTint="var(--green)" title={t('Checking…')} /></Section>

  const save = async next => {
    const c = normConfig(next)
    setConfig(c)
    latest.current = c
    const r = await saveGymConfig(c, useStore.getState().S)
    if (r?.permission) setPerm(r.permission)
    return r
  }

  // Off → on: explain, then ask for location while in use, "Always", and notifications.
  const turnOn = async () => {
    setBusy(true)
    try {
      let p = await gymPermissions()
      if (p?.background !== 'granted') {
        if (!(await explainAlways())) return
        p = await askForegroundLocation()
        if (p?.location !== 'granted') { setPerm(p); toast(noLocation()); return }
        p = await askBackgroundLocation()
        setPerm(p)
        if (p?.background !== 'granted') { toast(t('Without background location the phone can’t spot your gym while openGym is closed.')); return }
      }
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        let n = await LocalNotifications.checkPermissions()
        if (n.display !== 'granted') n = await LocalNotifications.requestPermissions()
        if (n.display !== 'granted') toast(t('Notifications are off for openGym, so the reminder has nowhere to show up.'))
      } catch { /* no plugin: the native side posts anyway where it may */ }
      await save({ ...config, on: true })
    } finally { setBusy(false) }
  }
  const toggle = v => (v ? turnOn() : save({ ...config, on: false }))

  const full = config.gyms.length >= MAX_GYMS
  // normGym keeps `off` only when it is true, so { off: false } switches a gym back on.
  const patchGym = (id, patch) => save({ ...config, gyms: config.gyms.map(g => (g.id === id ? { ...g, ...patch } : g)) })
  // Gone at once, with an Undo that puts it back where it was.
  const remove = g => {
    const at = config.gyms.findIndex(x => x.id === g.id)
    save({ ...config, gyms: config.gyms.filter(x => x.id !== g.id) })
    toast(t('“{0}” gone.', g.name || t('My gym')), { action: t('Undo'), onAction: () => {
      const c = latest.current
      if (!c || c.gyms.some(x => x.id === g.id)) return
      const gyms = [...c.gyms]
      gyms.splice(Math.min(at, gyms.length), 0, g)
      save({ ...c, gyms })
    } })
  }
  const rename = g => useUI.getState().openSheet(close => <RenameGym name={g.name} close={close} onSave={name => patchGym(g.id, { name })} />)
  const edit = g => nav('/settings/gym-edit', { state: { id: g.id } })
  const more = g => menuSheet({
    title: g.name || t('My gym'),
    subtitle: g.address || null,
    items: [
      { icon: 'pencil', label: t('Rename'), onClick: () => rename(g) },
      { icon: 'mapPin', label: t('Move it on the map'), sub: t('Radius and notification text too'), onClick: () => edit(g) },
      { icon: 'trash', label: t('Remove'), danger: true, onClick: () => remove(g) },
    ],
  })
  // iPhone: straight onto Apple Maps, then the details. Elsewhere the editor's own map.
  const add = async () => {
    const place = await pickNative(null)
    if (place === null) return
    nav('/settings/gym-edit', { state: { draft: place || {} } })
  }

  const win = config.window
  const setWin = patch => save({ ...config, window: { ...(win || DEFAULT_WINDOW), ...patch } })

  const card = g => {
    const name = g.name || t('My gym')
    const row = <div className={'item gym-item' + (g.off ? ' off' : '')}>
      <span className="lrow-i" style={{ '--tint': 'var(--orange)' }}><Icon name="mapPin" /></span>
      <button type="button" className="item-open grow" onClick={() => edit(g)}>
        <span className="tt">{name}</span>
        {g.address && <span className="ss">{g.address}</span>}
        <span className="ss">{t('{0} m around the pin', g.radius) + (g.text ? ' · ' + g.text : '')}</span>
      </button>
      <Switch checked={!g.off} onChange={v => patchGym(g.id, { off: !v })} aria-label={t('Remind me at {0}', name)} />
      <button type="button" className="gym-more" aria-label={t('More for {0}', name)} onClick={() => more(g)}><Icon name="more" /></button>
    </div>
    return swipe
      ? <SwipeRow key={g.id} className="swrow-item" deleteLabel={t('Remove')} onDelete={() => remove(g)}>{row}</SwipeRow>
      : <div key={g.id}>{row}</div>
  }

  return <>
    <Section footer={t('Walk into one of your gyms and openGym nudges you to hit Start. Once a day at most, and never when you already trained. Your gyms stay on this phone.')}>
      <Row icon="mapPin" iconTint="var(--green)" title={t('Gym reminder')}>
        <Switch checked={config.on} disabled={busy} onChange={toggle} aria-label={t('Gym reminder')} />
      </Row>
    </Section>
    <h2 className="sect-t gym-list-t">{t('Your gyms')}</h2>
    {config.gyms.length
      ? <div className="list gym-list">{config.gyms.map(card)}</div>
      : <div className="empty gym-empty"><div className="ico"><Icon name="mapPin" /></div>{t('No gyms yet.')}<br />{t('Add the one you keep meaning to go to.')}</div>}
    <div className="gym-add">
      {full
        ? <p className="sect-f">{t('That’s 20 gyms, the most a phone can watch.')}</p>
        : <Button variant="tinted" icon="plusCircle" onClick={add}>{t('Add a gym')}</Button>}
    </div>
    <Section footer={win ? t('Outside these hours the phone stays quiet, even at the gym.') : null}>
      <Row icon="clock" iconTint="var(--purple)" title={t('Only between certain hours')}>
        <Switch checked={!!win} onChange={v => save({ ...config, window: v ? { ...DEFAULT_WINDOW } : null })} aria-label={t('Only between certain hours')} />
      </Row>
      {win && <Row icon="sunrise" iconTint="var(--orange)" title={t('From')}>
        <input type="time" className="timef" value={win.from} aria-label={t('From')} onChange={e => e.target.value && setWin({ from: e.target.value })} />
      </Row>}
      {win && <Row icon="moon" iconTint="var(--indigo)" title={t('Until')}>
        <input type="time" className="timef" value={win.to} aria-label={t('Until')} onChange={e => e.target.value && setWin({ to: e.target.value })} />
      </Row>}
    </Section>
    {perm && <Section footer={perm.background === 'granted' ? null : perm.precise === false
      ? t('Precise location is off for openGym. Turn it on in the phone’s settings, or your gym can’t be spotted.')
      : t('The reminder needs location access in the background. You can allow it in the phone’s settings.')}>
      <Row icon="lock" iconTint="var(--grey)" title={t('Location access')} value={permLabel(perm)}
        accessory={perm.background === 'granted' ? 'none' : 'chevron'}
        onClick={perm.background === 'granted' ? undefined : () => openAppSettings()} />
    </Section>}
    {perm?.quick && perm.background === 'granted' && <Section footer={perm.quick === 'granted'
      ? t('Near a gym, the phone takes a short GPS look (a few minutes at most) so the nudge comes at the door.')
      : t('Android can take up to half an hour to notice you walked in. Set openGym’s battery use to Unrestricted and the phone takes a short GPS look when you get near a gym, so the nudge comes at the door.')}>
      <Row icon="bolt" iconTint="var(--orange)" title={t('Quick arrival check')} value={perm.quick === 'granted' ? t('On') : t('Off')}
        accessory={perm.quick === 'granted' ? 'none' : 'chevron'}
        onClick={perm.quick === 'granted' ? undefined : () => openAppSettings()} />
    </Section>}
  </>
}

/* ---------------- one gym ---------------- */

// The search above the web map: Enter or the button asks (never while typing, Nominatim's rule),
// the answers are cards like the exercise list, gyms first.
export function PlaceSearch({ near, onPick, search = searchPlaces }) {
  const toast = useUI(s => s.toast)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [searching, setSearching] = useState(false)
  // Only the latest question's answer is shown: an older one that comes in late is dropped.
  const asked = useRef(0)
  const run = async e => {
    e?.preventDefault()
    if (!q.trim()) return
    const n = ++asked.current
    setSearching(true)
    try {
      const r = await search(q, { near })
      if (n === asked.current) setHits(r)
    } catch { if (n === asked.current) toast(t('The search didn’t answer. Try again in a moment.')) }
    if (n === asked.current) setSearching(false)
  }
  const pick = h => { setHits(null); onPick(h) }
  return <div className="gmap-top">
    <form className="gmap-search" role="search" onSubmit={run}>
      <SearchField value={q} onChange={e => { setQ(e.target.value); if (!e.target.value) setHits(null) }} onClear={() => { setQ(''); setHits(null) }}
        placeholder={t('Find your gym…')} aria-label={t('Find your gym…')} inputMode="search" enterKeyHint="search" autoComplete="off" />
      {!!q.trim() && <Button type="submit" variant="primary" disabled={searching}>{searching ? t('Searching…') : t('Search')}</Button>}
    </form>
    <p className="gmap-note">{t('Searches go to OpenStreetMap. Your gyms stay on this phone.')}</p>
    {hits && <div className="list gmap-hits" role="list">
      {hits.length
        ? hits.map(h => <div key={h.id} role="listitem" className="item gmap-hit" {...tappable(() => pick(h))}>
          <span className="lrow-i" style={{ '--tint': h.fitness ? 'var(--acc)' : 'var(--grey)' }}><Icon name={h.fitness ? 'dumbbell' : 'mapPin'} /></span>
          <div className="grow"><div className="tt">{h.name}</div>{h.address && <div className="ss">{h.address}</div>}</div>
          {h.fitness && <span className="tag acc">{t('Gym')}</span>}
        </div>)
        : <div className="item gmap-hit none"><div className="grow"><div className="ss">{t('Nothing found. Try a street and a town.')}</div></div></div>}
    </div>}
  </div>
}

export function GymEditPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const toast = useUI(s => s.toast)
  const S = useStore(s => s.S)
  const [config, setConfig] = useState(null)
  const [gym, setGym] = useState(null)
  // null while asking, then whether the place is picked on Apple Maps (iPhone) or the web map.
  const [native, setNative] = useState(null)
  const [locating, setLocating] = useState(false)
  const editId = loc.state?.id || null
  useEffect(() => {
    let gone = false
    hasNativePicker().then(v => { if (!gone) setNative(v) })
    loadGymConfig().then(({ config: c }) => {
      if (gone) return
      setConfig(c)
      const have = editId && c.gyms.find(g => g.id === editId)
      const d = loc.state?.draft || {}
      setGym(have ? { ...have } : { id: null, name: d.name || '', address: d.address || '', lat: d.lat ?? null, lng: d.lng ?? null, radius: d.radius || RADIUS.def, text: '' })
    })
    return () => { gone = true }
  }, [])
  // Opened with nothing to show (no draft, a gym that is gone): back to the list.
  useEffect(() => { if (config && !gym) nav('/settings/gym', { replace: true }) }, [config, gym])
  if (!config || !gym || native === null) return null

  const pos = Number.isFinite(gym.lat) && Number.isFinite(gym.lng) ? { lat: gym.lat, lng: gym.lng } : null
  const set = patch => setGym(g => ({ ...g, ...patch }))
  const close = () => { if ((window.history.state?.idx || 0) > 0) nav(-1); else nav('/settings/gym', { replace: true }) }

  // A place from the search or Apple Maps: its name too, unless you already named the gym.
  const take = p => set({
    lat: p.lat, lng: p.lng, address: p.address || '',
    ...(p.radius ? { radius: p.radius } : {}),
    ...(gym.name.trim() || !p.name ? {} : { name: p.name.slice(0, 60) }),
  })
  // A pin moved by hand: the address the search found no longer says where it is.
  const moved = p => set({ lat: p.lat, lng: p.lng, address: '' })
  const here = async () => {
    if (!(await mayLocate())) { toast(noLocation()); return }
    setLocating(true)
    const h = await currentPosition()
    setLocating(false)
    if (h) moved(h)
    else toast(t('Couldn’t find where you are. Try the map instead.'))
  }
  const repick = async () => {
    const p = await pickNative(gym)
    if (p === undefined) { setNative(false); return }
    if (p) take(p)
  }
  const save = async () => {
    const g = normGym({ ...gym, id: gym.id || undefined })
    if (!g) { toast(t('Tap the map to put the pin on your gym first.')); return }
    const gyms = gym.id ? config.gyms.map(x => (x.id === gym.id ? g : x)) : [...config.gyms, g]
    await saveGymConfig({ ...config, gyms }, S)
    close()
  }
  const remove = () => confirmSheet({
    title: t('Remove this gym?'),
    message: t('No more nudges when you arrive here.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: async () => { await saveGymConfig({ ...config, gyms: config.gyms.filter(x => x.id !== gym.id) }, S); close() },
  })
  const fallback = statusOf(null).body
  const radiusLine = t('{0} m around the pin', gym.radius)

  return <>
    {native
      ? <Section>
        <Row icon="mapPin" iconTint="var(--orange)" title={pos ? gym.name || t('My gym') : t('Find your gym…')}
          subtitle={pos ? gym.address || radiusLine : t('Pick it on Apple Maps')} accessory="chevron" onClick={repick} />
      </Section>
      : <>
        <div className="gmap">
          <GymMap pos={pos} radius={gym.radius} onPick={moved} onRadius={r => set({ radius: r })}
            label={t('Tap the map or drag the pin onto your gym.')} handleLabel={t('Drag to change the radius')} />
          <PlaceSearch near={pos} onPick={take} />
          {pos && <span className="gmap-chip" aria-hidden="true">{radiusLine}</span>}
        </div>
        <p className="sect-f gmap-hint">{pos ? t('Drag the pin to move it, the handle on the circle to resize it.') : t('Tap the map or drag the pin onto your gym.')}</p>
        <div className="gmap-btns">
          <Button variant="primary" icon="location" onClick={here} disabled={locating}>{locating ? t('Finding you…') : t('I’m here right now')}</Button>
          <Button variant="plain" icon="map" disabled={!pos} onClick={() => window.open(googleMapsUrl(pos), '_blank', 'noopener')}>{t('Open in Google Maps')}</Button>
        </div>
      </>}
    <Section title={t('Radius')} footer={t('About 100 m fits most gyms. Bigger if the phone notices you late, smaller if it pings you on the street outside.')}>
      <div className="gym-radius-row">
        <Slider value={gym.radius} min={RADIUS.min} max={RADIUS.max} step={RADIUS.step} onChange={v => set({ radius: v })} />
        <span className="gym-radius-val">{t('{0} m', gym.radius)}</span>
      </div>
    </Section>
    <Section title={t('Name')}>
      <div className="gym-field"><TextField value={gym.name} maxLength={60} onChange={e => set({ name: e.target.value })} placeholder={t('My gym')} aria-label={t('Name')} /></div>
    </Section>
    <Section title={t('Notification text')} footer={t('Leave it empty for the default.')}>
      <div className="gym-field"><TextField value={gym.text} maxLength={120} onChange={e => set({ text: e.target.value })} placeholder={fallback} aria-label={t('Notification text')} /></div>
    </Section>
    <div className="gym-actions">
      <Button variant="primary" onClick={save} disabled={!pos}>{t('Save')}</Button>
      {gym.id && <Button variant="danger" icon="trash" onClick={remove}>{t('Remove')}</Button>}
    </div>
  </>
}
