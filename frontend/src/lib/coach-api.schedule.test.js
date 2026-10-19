// @vitest-environment happy-dom
// The phone's automatic reviews, at the door every Coach job goes through (Discord, 10-19). The
// data-sharing question was asked when they were switched on; nobody is there to ask it when one
// comes due, so a scheduled run never opens the sheet, and a yes withdrawn since means no run.
// And they speak only when there is something to suggest.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  coachLocal: { mode: 'byok' },
  disclosure: { provider: 'openai', providerLabel: 'OpenAI API', host: 'api.openai.com', categories: [], version: 1 },
  notifier: null,
  toast: null,
}))
vi.mock('./demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ MOBILE: true, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./api.js', () => ({ api: vi.fn(async () => ({})) }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: { coach: { cadence: { everyWorkouts: 3 } } }, coachLocal: mocks.coachLocal }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: mocks.toast }) } }))
vi.mock('../components/CoachConsentSheet.jsx', () => ({ askAiConsent: vi.fn(async () => true) }))
vi.mock('./coach-local.js', () => ({
  setNotifier: vi.fn(fn => { mocks.notifier = fn }),
  localDisclosure: vi.fn(async () => mocks.disclosure),
  localScheduled: vi.fn(async () => ({ job: { id: 'local-1', trigger: 'scheduled' } })),
}))

const { askAiConsent } = await import('../components/CoachConsentSheet.jsx')
const local = await import('./coach-local.js')
const { scheduledReview } = await import('./coach-api.js')
const { allowAi, consentTarget, _resetAiConsent } = await import('./coach-consent.js')
const { checkScheduledReview, mayBeDue } = await import('./coach-schedule.js')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  _resetAiConsent()
  mocks.coachLocal = { mode: 'byok' }
  mocks.toast = vi.fn()
})

describe('automatic reviews on a phone with its own key', () => {
  it('run with the yes given when they were switched on, and never ask again', async () => {
    await allowAi(consentTarget(mocks.disclosure, 'device'))
    expect(await scheduledReview()).toMatchObject({ job: { trigger: 'scheduled' } })
    expect(local.localScheduled).toHaveBeenCalledTimes(1)
    expect(askAiConsent).not.toHaveBeenCalled()
  })

  it('a yes withdrawn since means no run, and no dialog out of nowhere', async () => {
    expect(await scheduledReview()).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()
    expect(askAiConsent).not.toHaveBeenCalled()
  })

  it('a phone on its server leaves them to the server', async () => {
    mocks.coachLocal = { mode: 'server' }
    expect(await scheduledReview()).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()
  })

  it('speak only when there is something to suggest', async () => {
    await allowAi(consentTarget(mocks.disclosure, 'device'))
    await scheduledReview()   // loads the phone's Coach, which hands over its notifier
    mocks.notifier({ kind: 'failed', errorClass: 'provider', detail: '503', scheduled: true })
    mocks.notifier({ kind: 'nochange', reading: 'All good.', scheduled: true })
    expect(mocks.toast).not.toHaveBeenCalled()
    mocks.notifier({ kind: 'ready', pending: { changes: [{ id: 'c1' }, { id: 'c2' }] }, scheduled: true })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toMatch(/2 suggestions/)
    // A run somebody asked for still reports its failure, as before.
    mocks.notifier({ kind: 'failed', errorClass: 'provider', detail: '503' })
    expect(mocks.toast).toHaveBeenCalledTimes(2)
  })

  it('the minute check says no before loading anything when nothing could be due', async () => {
    expect(mayBeDue({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: 'off' } } })).toBe(false)
    expect(mayBeDue({ coachLocal: { mode: 'server' }, S: { coach: { cadence: { everyWorkouts: 3 } } } })).toBe(false)
    expect(mayBeDue({ coachLocal: null, S: { coach: { cadence: { weekly: { day: 0 } } } } })).toBe(false)
    expect(await checkScheduledReview(() => ({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: 'off' } } }))).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()

    await allowAi(consentTarget(mocks.disclosure, 'device'))
    expect(await checkScheduledReview(() => ({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: { everyWorkouts: 3 } } } }))).toBeTruthy()
    expect(local.localScheduled).toHaveBeenCalledTimes(1)
  })
})
