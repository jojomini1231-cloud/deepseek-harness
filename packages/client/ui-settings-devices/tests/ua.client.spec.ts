/** The display name a stored User-Agent derives, which the page's dictionary then words. */

import { describe, expect, it } from 'vitest'
import { deriveDeviceName } from '../src/client/ua.ts'

describe('deriveDeviceName', () => {
  it('names the browser and system of the common agents', () => {
    expect(deriveDeviceName(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    )).toEqual({ browser: 'chrome', platform: 'macos' })
    expect(deriveDeviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    )).toEqual({ browser: 'edge', platform: 'windows' })
    expect(deriveDeviceName(
      'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
    )).toEqual({ browser: 'firefox', platform: 'linux' })
    expect(deriveDeviceName(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    )).toEqual({ browser: 'safari', platform: 'macos' })
  })

  it('prefers the more specific family when a string claims two', () => {
    // Every Chromium agent claims Safari, and Edge claims Chrome.
    expect(deriveDeviceName('Chrome/141.0 Safari/537.36').browser).toBe('chrome')
    expect(deriveDeviceName('Chrome/141.0 Safari/537.36 Edg/141.0').browser).toBe('edge')
    // iOS also claims macOS, and Android also claims Linux.
    expect(deriveDeviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    ).platform).toBe('ios')
    expect(deriveDeviceName('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile').platform)
      .toBe('android')
  })

  it('falls back to an unnamed browser and system rather than guessing', () => {
    expect(deriveDeviceName('curl/8.7.1')).toEqual({ browser: 'other', platform: 'other' })
    expect(deriveDeviceName('')).toEqual({ browser: 'other', platform: 'other' })
  })
})
