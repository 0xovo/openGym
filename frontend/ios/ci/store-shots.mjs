// Store screenshots from the real iPhone/iPad app in the simulator (.github/workflows/store-shots.yml).
//
//   node ios/ci/store-shots.mjs <App.app/public/index.html> <lang>
//
// Puts a small driver into the app's index.html, for the screenshot run only (never committed into
// a build that ships): on first launch it stores the demo build's example history (lib/demoSeed.js,
// the one the website demo runs on) as the saved state, so the app opens on a lived-in log instead
// of the first-start choice, marks the rest notification as already asked (no system dialog over a
// screenshot), then walks the screens. Before each screen is ready it logs "STORESHOT <name>" and
// holds still; the workflow, reading the app's console, takes the picture. "STORESHOT-DONE" ends it.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildDemoState } from '../../src/lib/demoSeed.js'

const [, , file, lang = 'en'] = process.argv
if (!file) { console.error('usage: store-shots.mjs <index.html> <lang>'); process.exit(2) }

const strings = lang === 'en' ? {} : (await import(`../../src/locales/${lang}.js`)).default
const tr = s => strings[s] || s
const L = {
  save: tr('Save & start workout'), done: tr('Set {0} done'), cards: tr('Cards'), chest: tr('Chest'),
  balance: tr('Muscle balance'),
}
const seed = { ...buildDemoState(), lang }

const driver = `<script>
/* store-shots driver: screenshot runs only */
(function () {
  var L = ${JSON.stringify(L)}, HOLD = 7000
  try {
    if (!localStorage.getItem('gym_state_v1')) localStorage.setItem('gym_state_v1', ${JSON.stringify(JSON.stringify(seed))})
    localStorage.setItem('gym_rest_notif_asked', 'denied')
  } catch (e) {}
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  var byText = function (text, sel) {
    var all = document.querySelectorAll(sel || 'button,a,[role=button],[role=switch],[role=tab],.lrow,div.item,span.tag')
    for (var i = 0; i < all.length; i++) { var e = all[i]; if ((e.getAttribute('aria-label') || e.textContent || '').trim() === text) return e }
    return null
  }
  var click = function (el) { if (el) el.click(); return !!el }
  var go = function (route) { location.hash = '#' + route }
  var snap = async function (name) { await sleep(2600); window.scrollTo(0, window.scrollY); console.log('STORESHOT ' + name); await sleep(HOLD) }
  async function run () {
    for (var i = 0; i < 120 && !document.getElementById('tabbar'); i++) await sleep(500)
    if (!document.getElementById('tabbar')) { console.log('STORESHOT-FAIL no tab bar'); return }
    await sleep(3000)
    go('/home'); await snap('1-home')
    go('/plan'); await snap('5-plan')
    go('/stats'); await snap('4-stats')
    go('/stats'); await sleep(1500)
    click(byText('30d'))
    await sleep(1200)
    var t = byText(L.balance, 'button,[role=tab],h2,h3,div.h')
    var card = t && (t.closest('.card') || t.parentElement)
    if (card) { card.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90) }
    await snap('7-muscles')
    go('/library'); await sleep(1500)
    click(document.querySelector('button[aria-label="' + L.cards + '"]'))
    await sleep(800)
    var chips = document.querySelectorAll('button.chip')
    for (var c = 0; c < chips.length; c++) if (chips[c].textContent.trim().toLowerCase() === L.chest.toLowerCase()) { chips[c].click(); break }
    await snap('6-library')
    go('/home'); await sleep(1500)
    click(document.querySelector('#tabbar button.start'))
    await sleep(2500)
    var save = byText(L.save)
    if (save) { await snap('3-checkin'); click(byText(L.save)); await sleep(2500) }
    for (var n = 1; n <= 2; n++) { click(document.querySelector('[aria-label="' + L.done.replace('{0}', n) + '"]')); await sleep(1500) }
    await sleep(4000)
    await snap('2-workout')
    console.log('STORESHOT-DONE')
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run()
})()
</script>`

const html = readFileSync(file, 'utf8')
if (html.includes('store-shots driver')) { console.log('driver already in', file); process.exit(0) }
const at = html.indexOf('<meta charset="UTF-8">')
if (at < 0) { console.error('no <meta charset> in', file); process.exit(1) }
const cut = at + '<meta charset="UTF-8">'.length
writeFileSync(file, html.slice(0, cut) + '\n' + driver + html.slice(cut))
console.log(`driver (${lang}, ${seed.workouts.length} workouts) put into ${file}`)
