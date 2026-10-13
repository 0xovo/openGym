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
const widgets = join(root, 'ios', 'App', 'WatchWidgets')

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
  'measuring': {
    de: 'misst …', fr: 'mesure …', es: 'midiendo …', it: 'misuro …', 'pt-PT': 'a medir …', 'pt-BR': 'medindo …', pl: 'mierzę …',
    hu: 'mérés …', tr: 'ölçülüyor …', ru: 'измеряю …', uk: 'вимірюю …', ar: 'جارٍ القياس …', hi: 'माप रहा है …', bn: 'মাপা হচ্ছে …',
    th: 'กำลังวัด …', ko: '측정 중 …', 'zh-Hans': '测量中 …', 'zh-Hant': '測量中 …',
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

// Info.plist's own (the Apple Health permission prompts), into InfoPlist.strings.
const PLIST = {
  NSHealthShareUsageDescription: {
    de: 'openGym zeigt deinen Puls während des Trainings und neben jedem Satz.', fr: 'openGym affiche ton pouls pendant la séance et à côté de chaque série.',
    es: 'openGym muestra tu pulso durante el entreno y junto a cada serie.', it: 'openGym mostra il tuo battito durante l’allenamento e accanto a ogni serie.',
    'pt-PT': 'O openGym mostra a tua frequência cardíaca durante o treino e ao lado de cada série.', 'pt-BR': 'O openGym mostra sua frequência cardíaca durante o treino e ao lado de cada série.',
    pl: 'openGym pokazuje tętno podczas treningu i przy każdej serii.', hu: 'Az openGym edzés közben és minden sorozat mellett mutatja a pulzusodat.',
    tr: 'openGym antrenman sırasında ve her setin yanında nabzını gösterir.', ru: 'openGym показывает пульс во время тренировки и рядом с каждым подходом.',
    uk: 'openGym показує пульс під час тренування і біля кожного підходу.', ar: 'يعرض openGym نبضك أثناء التمرين وبجانب كل مجموعة.',
    hi: 'openGym वर्कआउट के दौरान और हर सेट के साथ आपकी धड़कन दिखाता है।', bn: 'openGym ওয়ার্কআউটের সময় আর প্রতিটি সেটের পাশে আপনার হার্ট রেট দেখায়।',
    th: 'openGym แสดงอัตราการเต้นของหัวใจระหว่างฝึกและข้างแต่ละเซ็ต', ko: 'openGym이 운동 중과 각 세트 옆에 심박수를 보여줘요.',
    'zh-Hans': 'openGym 会在训练中和每组旁显示你的心率。', 'zh-Hant': 'openGym 會在訓練中和每組旁顯示你的心率。',
  },
  NSHealthUpdateUsageDescription: {
    de: 'openGym speichert deine Trainings in Apple Health, wenn du das einschaltest.', fr: 'openGym enregistre tes séances dans Apple Santé si tu l’actives.',
    es: 'openGym guarda tus entrenos en Apple Salud si lo activas.', it: 'openGym salva i tuoi allenamenti in Apple Salute se lo attivi.',
    'pt-PT': 'O openGym guarda os teus treinos no Apple Saúde se o ativares.', 'pt-BR': 'O openGym salva seus treinos no Apple Saúde se você ativar.',
    pl: 'openGym zapisuje treningi w Apple Zdrowie, jeśli to włączysz.', hu: 'Az openGym az Apple Egészség appba menti az edzéseidet, ha bekapcsolod.',
    tr: 'Açarsan openGym antrenmanlarını Apple Sağlık’a kaydeder.', ru: 'openGym сохраняет тренировки в Apple Здоровье, если вы это включите.',
    uk: 'openGym зберігає тренування в Apple Здоров’я, якщо ти це ввімкнеш.', ar: 'يحفظ openGym تمارينك في Apple صحتي إذا فعّلت ذلك.',
    hi: 'चालू करने पर openGym आपके वर्कआउट Apple Health में सहेजता है।', bn: 'চালু করলে openGym আপনার ওয়ার্কআউট Apple Health-এ সেভ করে।',
    th: 'openGym บันทึกการฝึกลงใน Apple Health เมื่อคุณเปิดใช้', ko: '켜면 openGym이 운동을 Apple 건강에 저장해요.',
    'zh-Hans': '打开后，openGym 会把训练保存到 Apple 健康。', 'zh-Hant': '開啟後，openGym 會把訓練儲存到 Apple 健康。',
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
  // The widget says a few of the same words (Rest, Start workout).
  mkdirSync(join(widgets, `${lproj}.lproj`), { recursive: true })
  writeFileSync(join(widgets, `${lproj}.lproj`, 'Localizable.strings'), lines.join('\n') + '\n')
  const plist = [`/* openGym on the Apple Watch, ${lproj}: Info.plist. Written by ios/ci/watch-strings.mjs. */`, '']
  for (const [k, tr] of Object.entries(PLIST)) {
    if (!tr[lproj] || /—/.test(tr[lproj])) { console.error(`${lproj}: ${k} missing or with an em dash`); problems++; continue }
    plist.push(`"${k}" = "${esc(tr[lproj])}";`)
  }
  writeFileSync(join(out, `${lproj}.lproj`, 'InfoPlist.strings'), plist.join('\n') + '\n')
}
if (problems) process.exit(1)
console.log(`wrote ${Object.keys(LANGS).length} languages`)
