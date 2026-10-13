// Settings → Workout → Animation quality, and the hooks that put the chosen quality on screen
// (store apps only; the web and a self-hosted server show nothing new and keep their 180 px
// files). The rules are lib/anim-quality.js, the packs and the per-device choice lib/anim-packs.js.
import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { gifSrc, figureOf } from '../lib/exercises.js'
import { fmtMB } from '../lib/media-limits.js'
import { BUILTIN_PX, packQualities, packId, wantedQuality, clipSources } from '../lib/anim-quality.js'
import { subscribe, getState, installedBases, deviceInfo, refresh, ensureWanted, writePrefs, download, remove } from '../lib/anim-packs.js'
import { Section, Row, Switch, Button } from './ui.jsx'
import { useUI } from '../store/useUI.js'

const MB = 1024 * 1024
export const useAnimPacks = () => useSyncExternalStore(subscribe, getState, getState)

/**
 * Where a built-in exercise's animation comes from, best first (lib/anim-quality.js clipSources):
 * `{ still, sources }`. Off the store apps, always the built-in file.
 */
export function useAnimSources(ex, figure) {
  const packs = useAnimPacks()
  const builtin = ex?.gif ? gifSrc(ex, figure) : null
  if (!MOBILE) return { still: false, sources: builtin ? [builtin] : [] }
  const choice = packs.available ? packs.prefs.choice : (packs.prefs.choice === 'still' ? 'still' : 'builtin')
  return clipSources({ ex, figure, choice, device: deviceInfo(), installed: installedBases(packs), builtin })
}

/** Shell: what the device has, once, and the pack the choice wants for the figure shown. */
export function useAnimPacksBoot() {
  const figure = useStore(s => figureOf(s.S))
  useEffect(() => { if (MOBILE) refresh().then(() => ensureWanted(figure)).catch(() => {}) }, [])
  useEffect(() => { if (MOBILE && getState().checked) ensureWanted(figure) }, [figure])
}

// "Auto (360 px)", "Still only", "Built in (180 px)", "720 px".
export function choiceLabel(choice, packs = getState()) {
  if (choice === 'still') return t('Still only')
  if (choice === 'builtin' || !packs.available) return t('Built in ({0} px)', BUILTIN_PX)
  if (choice === 'auto') {
    const q = wantedQuality('auto', deviceInfo())
    return t('Auto ({0})', q === 'builtin' ? t('{0} px', BUILTIN_PX) : t('{0} px', q))
  }
  return t('{0} px', choice)
}

export function AnimationQualityRow() {
  const packs = useAnimPacks()
  if (!MOBILE) return null
  return <Row icon="image" iconTint="var(--indigo)" title={t('Animation quality')} value={choiceLabel(packs.prefs.choice, packs)} accessory="chevron"
    onClick={() => useUI.getState().openSheet(close => <AnimationQualitySheet close={close} />)} />
}

// One pack's line under its quality: downloaded and how big, on its way, waiting for Wi-Fi.
function packLine(p) {
  if (!p || p.state === 'none' || !p.state) return t('Not downloaded')
  if (p.state === 'ready') return t('Downloaded · {0}', t('{0} MB', fmtMB(Math.max(0.1, (p.bytes || 0) / MB))))
  if (p.state === 'downloading') return t('Downloading… {0}%', Math.round((p.progress || 0) * 100))
  if (p.state === 'needs-wifi') return t('Waiting for Wi-Fi')
  return t('Download failed. Tap to try again.')
}

export function AnimationQualitySheet({ close }) {
  const packs = useAnimPacks()
  const figure = useStore(s => figureOf(s.S))
  const { choice, wifiOnly } = packs.prefs
  const pick = c => { writePrefs({ choice: c }); ensureWanted(figure) }
  const retry = id => () => download(id)
  const qualities = packs.available ? packQualities() : []
  const ready = Object.entries(packs.packs).filter(([, p]) => p.state === 'ready')
  return <>
    <h3>{t('Animation quality')}</h3>
    <Section footer={packs.available
      ? t('Sharper animations download once per figure. Until they’re here you see the built-in ones, so nothing ever goes blank.')
      : t('Sharper animations aren’t available on this device yet. The built-in ones work everywhere.')}>
      {packs.available && <Row title={choiceLabel('auto', packs)} subtitle={t('A good size for this screen.')} accessory={choice === 'auto' ? 'check' : 'none'} onClick={() => pick('auto')} />}
      <Row title={t('Still only')} subtitle={t('No animation, just the picture. Easy on battery.')} accessory={choice === 'still' ? 'check' : 'none'} onClick={() => pick('still')} />
      <Row title={choiceLabel('builtin', packs)} accessory={choice === 'builtin' || (!packs.available && choice !== 'still') ? 'check' : 'none'} onClick={() => pick('builtin')} />
      {qualities.map(px => {
        const id = packId(px, figure)
        const p = packs.packs[id]
        const failed = p?.state === 'failed' || p?.state === 'needs-wifi'
        return <Row key={px} title={t('{0} px', px)} subtitle={packLine(p)} accessory={choice === px ? 'check' : 'none'}
          onClick={failed && choice === px ? retry(id) : () => pick(px)} />
      })}
    </Section>
    {packs.available && <Section>
      <Row icon="cloud" iconTint="var(--blue)" title={t('Download over Wi-Fi only')}>
        <Switch checked={wifiOnly} onChange={v => writePrefs({ wifiOnly: v })} />
      </Row>
    </Section>}
    {ready.length > 0 && <Section title={t('On this device')}>
      {ready.map(([id, p]) => {
        const [, px, fig] = /^anim-(\d+)-(male|female)$/.exec(id) || []
        return <Row key={id} title={t('{0} px', px) + ' · ' + (fig === 'female' ? t('Female') : t('Male'))}
          subtitle={t('{0} MB', fmtMB(Math.max(0.1, (p.bytes || 0) / MB)))}>
          <Button size="sm" variant="danger" onClick={() => remove(id)}>{t('Delete')}</Button>
        </Row>
      })}
    </Section>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}
