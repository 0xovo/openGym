#!/usr/bin/env node
// Writes the Apple Watch app's strings (ios/App/Watch/<lang>.lproj/Localizable.strings) in every
// language the app speaks. Words the app already has come from its own locale packs
// (frontend/src/locales), so the watch says "Done" exactly as the phone does; the few phrases only
// the watch uses are below. Run it after changing either, and commit what it writes:
//
//   node frontend/ios/ci/watch-strings.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'ios', 'App', 'Watch')

// app pack → watch .lproj
const LANGS = {
  de: 'de', fr: 'fr', es: 'es', it: 'it', pt: 'pt-PT', 'pt-BR': 'pt-BR', pl: 'pl', hu: 'hu', tr: 'tr',
  ru: 'ru', uk: 'uk', ar: 'ar', hi: 'hi', bn: 'bn', th: 'th', ko: 'ko', zh: 'zh-Hans', 'zh-TW': 'zh-Hant',
}

// The watch's key (what the Swift source says) → the app's key, for words the app already has.
const FROM_APP = {
  'Today': 'Today',
  'Start workout': 'Start workout',
  'Done': 'Done',
  'Warm-up': 'Warm-up',
  'Reps': 'Reps',
  'Rest': 'Rest',
  'Skip': 'Skip',
  'Finish workout': 'Finish workout',
  'Finish workout?': 'Finish workout?',
  'Finish and save': 'Finish and save',
  'Cancel': 'Cancel',
  'Rest’s over. Next set!': 'Rest’s over. Next set!',
}
// Built from an app word: "Last time: %@".
const COMPOSED = { 'Last time: %@': ['Last time', w => `${w}: %@`] }

// Only the watch says these. %@ is a name, %lld a number, as the Swift source interpolates them.
const OWN = {
  'No workout running': {
    de: 'Kein Training läuft', fr: 'Aucune séance en cours', es: 'Ningún entreno en curso', it: 'Nessun allenamento in corso',
    'pt-PT': 'Nenhum treino a decorrer', 'pt-BR': 'Nenhum treino em andamento', pl: 'Żaden trening nie trwa', hu: 'Nincs folyamatban edzés',
    tr: 'Devam eden antrenman yok', ru: 'Тренировка не идёт', uk: 'Тренування не триває', ar: 'لا يوجد تمرين جارٍ',
    hi: 'कोई वर्कआउट नहीं चल रहा', bn: 'কোনো ওয়ার্কআউট চলছে না', th: 'ไม่มีการฝึกที่กำลังทำอยู่', ko: '진행 중인 운동이 없어요',
    'zh-Hans': '没有进行中的训练', 'zh-Hant': '沒有進行中的訓練',
  },
  'Start one on your iPhone and it shows up here.': {
    de: 'Starte eins auf dem iPhone, dann taucht es hier auf.', fr: 'Lance-en une sur ton iPhone et elle apparaît ici.',
    es: 'Empieza uno en tu iPhone y aparecerá aquí.', it: 'Avviane uno sull’iPhone e comparirà qui.',
    'pt-PT': 'Começa um no iPhone e ele aparece aqui.', 'pt-BR': 'Comece um no iPhone e ele aparece aqui.',
    pl: 'Zacznij trening na iPhonie, a pojawi się tutaj.', hu: 'Indíts egyet az iPhone-on, és itt megjelenik.',
    tr: 'iPhone’unda bir tane başlat, burada görünür.', ru: 'Начните её на iPhone, и она появится здесь.',
    uk: 'Почни його на iPhone, і воно з’явиться тут.', ar: 'ابدأ تمرينًا على iPhone وسيظهر هنا.',
    hi: 'iPhone पर एक शुरू करें, यह यहाँ दिखेगा।', bn: 'iPhone-এ একটি শুরু করুন, এখানে দেখা যাবে।',
    th: 'เริ่มบน iPhone แล้วจะแสดงที่นี่', ko: 'iPhone에서 시작하면 여기에 나타나요.',
    'zh-Hans': '在 iPhone 上开始，它就会出现在这里。', 'zh-Hant': '在 iPhone 上開始，它就會出現在這裡。',
  },
  'All sets done': {
    de: 'Alle Sätze erledigt', fr: 'Toutes les séries faites', es: 'Todas las series hechas', it: 'Tutte le serie fatte',
    'pt-PT': 'Todas as séries feitas', 'pt-BR': 'Todas as séries feitas', pl: 'Wszystkie serie zrobione', hu: 'Minden sorozat kész',
    tr: 'Tüm setler tamam', ru: 'Все подходы сделаны', uk: 'Усі підходи зроблено', ar: 'اكتملت كل المجموعات',
    hi: 'सारे सेट पूरे', bn: 'সব সেট শেষ', th: 'ครบทุกเซ็ตแล้ว', ko: '모든 세트 완료', 'zh-Hans': '所有组已完成', 'zh-Hant': '所有組已完成',
  },
  'Next: %@, set %lld': {
    de: 'Als Nächstes: %@, Satz %lld', fr: 'Ensuite : %@, série %lld', es: 'Siguiente: %@, serie %lld', it: 'Poi: %@, serie %lld',
    'pt-PT': 'A seguir: %@, série %lld', 'pt-BR': 'A seguir: %@, série %lld', pl: 'Dalej: %@, seria %lld', hu: 'Következik: %@, %lld. sorozat',
    tr: 'Sıradaki: %@, set %lld', ru: 'Далее: %@, подход %lld', uk: 'Далі: %@, підхід %lld', ar: 'التالي: %@، المجموعة %lld',
    hi: 'अगला: %@, सेट %lld', bn: 'এরপর: %@, সেট %lld', th: 'ถัดไป: %@ เซ็ต %lld', ko: '다음: %@, %lld세트',
    'zh-Hans': '下一个：%@，第 %lld 组', 'zh-Hant': '下一個：%@，第 %lld 組',
  },
  '%@, set %lld': {
    de: '%@, Satz %lld', fr: '%@, série %lld', es: '%@, serie %lld', it: '%@, serie %lld', 'pt-PT': '%@, série %lld', 'pt-BR': '%@, série %lld',
    pl: '%@, seria %lld', hu: '%@, %lld. sorozat', tr: '%@, set %lld', ru: '%@, подход %lld', uk: '%@, підхід %lld', ar: '%@، المجموعة %lld',
    hi: '%@, सेट %lld', bn: '%@, সেট %lld', th: '%@ เซ็ต %lld', ko: '%@, %lld세트', 'zh-Hans': '%@，第 %lld 组', 'zh-Hant': '%@，第 %lld 組',
  },
}

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
let problems = 0
for (const [pack, lproj] of Object.entries(LANGS)) {
  const { default: dict } = await import(pathToFileURL(join(root, 'src', 'locales', pack + '.js')).href)
  const lines = [`/* openGym on the Apple Watch, ${lproj}. Written by ios/ci/watch-strings.mjs: change that, not this. */`, '']
  const put = (k, v) => {
    if (!v) { console.error(`${lproj}: no word for "${k}"`); problems++; return }
    if (/—/.test(v)) { console.error(`${lproj}: em dash in "${k}"`); problems++ }
    lines.push(`"${esc(k)}" = "${esc(v)}";`)
  }
  for (const [k, appKey] of Object.entries(FROM_APP)) put(k, dict[appKey])
  for (const [k, [appKey, f]] of Object.entries(COMPOSED)) put(k, dict[appKey] && f(dict[appKey]))
  for (const [k, tr] of Object.entries(OWN)) put(k, tr[lproj])
  mkdirSync(join(out, `${lproj}.lproj`), { recursive: true })
  writeFileSync(join(out, `${lproj}.lproj`, 'Localizable.strings'), lines.join('\n') + '\n')
}
if (problems) process.exit(1)
console.log(`wrote ${Object.keys(LANGS).length} languages`)
