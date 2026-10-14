// Settings → Apple Watch (iPhone app only): whether the watch app is there, and this phone's
// choices for it (lib/watch-settings.js), which the watch gets with every snapshot.
//
// Apple Health is one switch for phone and watch: the Apple Health card in Settings → Data. This
// page only says what the watch makes of it (measuring, off, or not allowed there) and leads to it.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch, SelectRow } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, readWatchStatus, onWatchPrefs } from '../lib/watch-settings.js'
import { watchStatus } from '../lib/watch-sync.js'
import { loadHealth, onHealthChange } from '../lib/health-sync.js'

export default function WatchSettingsPage() {
  const nav = useNavigate()
  const [prefs, setPrefs] = useState(readWatchPrefs)
  const [status, setStatus] = useState(readWatchStatus)
  const [link, setLink] = useState(null)   // { paired, installed } from the phone, or null while asking
  const [healthOn, setHealthOn] = useState(null)   // the phone's Apple Health switch, null while reading
  useEffect(() => onWatchPrefs(() => { setPrefs(readWatchPrefs()); setStatus(readWatchStatus()) }), [])
  // Asked again while the phone's link to the watch is still starting (right after launch it knows
  // nothing yet, and "no watch" would be wrong), for up to a few seconds.
  useEffect(() => {
    let gone = false, tries = 0, tm = null
    const ask = () => watchStatus()
      .then(st => {
        if (gone) return
        if (st.activated === false && tries++ < 8) { tm = setTimeout(ask, 750); return }
        setLink(st)
      })
      .catch(() => { if (!gone) setLink({ paired: false, installed: false }) })
    ask()
    return () => { gone = true; clearTimeout(tm) }
  }, [])
  useEffect(() => {
    let gone = false
    loadHealth().then(h => { if (!gone) setHealthOn(!!h?.on) }).catch(() => { if (!gone) setHealthOn(false) })
    const off = onHealthChange(h => setHealthOn(!!h?.on))
    return () => { gone = true; off() }
  }, [])
  const set = patch => setPrefs(writeWatchPrefs(patch))

  const linkLine = !link ? t('Checking…')
    : !link.paired ? t('No Apple Watch paired with this iPhone')
    : !link.installed ? t('openGym is not on your Apple Watch yet. Install it in the Watch app.')
    : t('openGym is on your Apple Watch')
  const denied = healthOn && status?.health === 'denied'
  const healthValue = healthOn == null ? '' : denied ? t('Not allowed') : healthOn ? t('On') : t('Off')
  const healthLine = denied ? t('Not allowed on the watch. Allow it in the Health app on your iPhone.')
    : healthOn ? t('Heart rate during the workout and next to each set, and the workout saved to Apple Health. The watch asks once.')
    : t('Turn on Apple Health and the watch measures your heart rate for every set.')
  // The one Apple Health switch, on its own card in Settings → Data.
  const openHealth = () => nav('/settings/data', { state: { find: 'Write to Apple Health' } })

  return <>
    <Section footer={linkLine}>
      <Row icon="watch" iconTint="var(--grey)" title={t('Send workouts to the watch')}>
        <Switch checked={prefs.enabled} onChange={v => set({ enabled: v })} aria-label={t('Send workouts to the watch')} />
      </Row>
    </Section>
    {prefs.enabled && <>
      <Section footer={t('Start a workout on the phone and openGym pops up on your wrist.')}>
        <Row icon="bolt" iconTint="var(--green)" title={t('Open on the watch')}>
          <Switch checked={prefs.autoShow} onChange={v => set({ autoShow: v })} aria-label={t('Open on the watch')} />
        </Row>
      </Section>
      <Section footer={healthLine}>
        <Row icon="heart" iconTint="var(--red)" title={t('Apple Health')} value={healthValue} accessory="chevron" onClick={openHealth} />
      </Section>
      <Section>
        <Row icon="vibrate" iconTint="var(--indigo)" title={t('Tap the wrist when a rest is over')}>
          <Switch checked={prefs.restHaptics} onChange={v => set({ restHaptics: v })} aria-label={t('Tap the wrist when a rest is over')} />
        </Row>
        <SelectRow icon="stopwatch" iconTint="var(--orange)" title={t('The Digital Crown turns first')} value={prefs.crown}
          onChange={v => set({ crown: v })}
          options={[{ value: 'reps', label: t('Reps') }, { value: 'weight', label: t('Weight') }]} />
      </Section>
    </>}
  </>
}
