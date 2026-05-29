import { test, expect } from '@playwright/test'
import { delegateFillMode } from '../src/lib/delegates.js'

test.describe('autofill delegate display helpers', () => {
  test('infers same-profile delegates before and after same-profile use', () => {
    expect(delegateFillMode({ bcCount: 0, relayCount: 0 })).toBe('same profile')
    expect(delegateFillMode({ bcCount: 74, relayCount: 0 })).toBe('same profile')
  })

  test('infers cross-profile delegates from pairing metadata or relay use', () => {
    expect(delegateFillMode({ pairingId: 'pair-1', relayUrl: 'ws://localhost:7577', bcCount: 0, relayCount: 0 })).toBe('cross profile')
    expect(delegateFillMode({ bcCount: 0, relayCount: 74 })).toBe('cross profile')
  })

  test('shows both modes if a delegate has unexpected mixed usage', () => {
    expect(delegateFillMode({ bcCount: 10, relayCount: 64 })).toBe('same profile + cross profile')
  })
})
