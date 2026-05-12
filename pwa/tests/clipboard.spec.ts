import { test, expect, type Page } from '@playwright/test'
import { openVault } from './helpers'

// ── mock helpers ──────────────────────────────────────────────────────────────

// Shorten the 30s autoclear timer to 200ms, and make clipboard ops throw when
// document.hidden is true — matching real browser behaviour in a background tab.
async function setupMocks(page: Page) {
  await page.addInitScript(() => {
    const _st = window.setTimeout
    ;(window as any).setTimeout = (fn: TimerHandler, delay?: number, ...args: any[]) =>
      _st(fn as any, (delay ?? 0) >= 9000 ? 200 : delay, ...args)

    const _read  = navigator.clipboard.readText.bind(navigator.clipboard)
    const _write = navigator.clipboard.writeText.bind(navigator.clipboard)
    const blocked = () => { throw Object.assign(new Error('Document is not focused'), { name: 'NotAllowedError' }) }

    Object.defineProperty(navigator.clipboard, 'readText',  { configurable: true, value: async () => document.hidden ? blocked() : _read() })
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (t: string) => document.hidden ? blocked() : _write(t) })
  })
}

async function simulateHide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

async function simulateShow(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

// "three entry 3" (group "group 3") sorts first — space sorts before '1'
const FIRST_PASSWORD = ',./<>?`~0'

// Double-click the first record to copy its password.
// Waits for clipboard content to confirm the async write completed.
async function copyPassword(page: Page) {
  await page.locator('.record-row').first().dblclick()
  await page.waitForFunction(
    () => navigator.clipboard.readText().then(t => t.length > 0),
    { timeout: 3000 }
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Clipboard autoclear', () => {

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await setupMocks(page)
    await openVault(page)
  })

  test('clears clipboard after timeout while page remains visible', async ({ page }) => {
    await copyPassword(page)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_PASSWORD)

    await page.waitForTimeout(500)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('')
  })

  test('does not clear if user copied something else before timeout', async ({ page }) => {
    await copyPassword(page)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_PASSWORD)

    await page.evaluate(() => navigator.clipboard.writeText('something unrelated'))

    await page.waitForTimeout(500)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('something unrelated')
  })

  test('clears when user returns to page after timer elapsed while backgrounded', async ({ page }) => {
    await copyPassword(page)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_PASSWORD)

    await simulateHide(page)
    await page.waitForTimeout(400) // timer fires while hidden — clipboard blocked, clipHash preserved

    await simulateShow(page)
    await page.waitForTimeout(300) // async clear triggered by visibilitychange

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('')
  })

  test('does not clear on return if clipboard was overwritten while backgrounded', async ({ page }) => {
    await copyPassword(page)

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_PASSWORD)

    await simulateHide(page)
    await page.waitForTimeout(400) // timer fires while hidden

    // Simulate user copying from another app (temporarily unhide to allow clipboard write)
    await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      await navigator.clipboard.writeText('from another app')
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    })

    await simulateShow(page)
    await page.waitForTimeout(300) // hash won't match — clipboard left alone

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('from another app')
  })

})
