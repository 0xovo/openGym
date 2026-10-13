// Settings → Apple Watch (iPhone app only): whether the watch app is there, and this phone's
// choices for it (lib/watch-settings.js), which the watch gets with every snapshot.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Section, Row, Switch, SelectRow } from '../components/ui.jsx'
import { readWatchPrefs, writeWatchPrefs, readWatchStatus, onWatchPrefs } from '../lib/watch-settings.js'
import { watchStatus } from '../lib/watch-sync.js'

export default function WatchSettingsPage() {
  const [prefs, setPrefs] = useState(readWatchPrefs)
  const [status, setStatus] = useState(readWatchStatus)
  const [link, setLink] = useState(null)   // { paired, installed } from the phone, or null while asking
  useEffect(() => onWatchPrefs(() => { setPrefs(readWatchPrefs()); setStatus(readWatchStatus()) }), [])
  useEffect(() => { watchStatus().then(setLink).catch(() => setLink({ paired: false, installed: false })) }, [])
  const set = patch => setPrefs(writeWatchPrefs(patch))

  const linkLine = !link ? t('Checking…')
    : !link.paired ? t('No Apple Watch paired with this iPhone')
    : !link.installed ? t('openGym is not on your Apple Watch yet. Install it in the Watch app.')
    : t('openGym is on your Apple Watch')
  const healthLine = status?.health === 'denied' ? t('Not allowed on the watch. Allow it in the Health app on your iPhone.')
    : t('Heart rate during the workout and next to each set, and the workout saved to Apple Health. The watch asks once.')

  return <>
    <Section footer={linkLine}>
      <Row icon="watch" iconTint="var(--grey)" title={t('Send workouts to the watch')}>
        <Switch checked={prefs.enabled} onChange={v => set({ enabled: v })} aria-label={t('Send workouts to the watch')} />
      </Row>
    </Section>
    {prefs.enabled && <>
      <Section footer={healthLine}>
        <Row icon="heart" iconTint="var(--red)" title={t('Apple Health on the watch')}>
          <Switch checked={prefs.health} onChange={v => set({ health: v })} aria-label={t('Apple Health on the watch')} />
        </Row>
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
