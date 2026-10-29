import { describe, it, expect } from 'vitest'
import { parseAuthProviders } from './firebase-config.js'

describe('firebase-config parseAuthProviders', () => {
  it('falls back to passkey when nothing is configured', () => {
    expect(parseAuthProviders(undefined)).toEqual(['passkey'])
    expect(parseAuthProviders('')).toEqual(['passkey'])
  })

  it('accepts each known provider on its own', () => {
    expect(parseAuthProviders('google')).toEqual(['google'])
    expect(parseAuthProviders('passkey')).toEqual(['passkey'])
  })

  it('keeps the order given, not the declaration order', () => {
    expect(parseAuthProviders('passkey,google')).toEqual(['passkey', 'google'])
    expect(parseAuthProviders('google,passkey')).toEqual(['google', 'passkey'])
  })

  it('ignores spaces and case', () => {
    expect(parseAuthProviders(' Google , PASSKEY ')).toEqual(['google', 'passkey'])
  })

  it('dedupes repeated names', () => {
    expect(parseAuthProviders('google, google,GOOGLE,passkey,passkey')).toEqual(['google', 'passkey'])
  })

  it('drops unknown names, alone or mixed in', () => {
    expect(parseAuthProviders('github,otp')).toEqual(['passkey'])
    expect(parseAuthProviders('github, Google ,otp')).toEqual(['google'])
  })
})
