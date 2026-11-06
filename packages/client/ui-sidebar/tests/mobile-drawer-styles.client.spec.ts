/** Phone drawer geometry: the frame column owns the safe area, the shell keeps one 44px trigger. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const drawer = readFileSync(new URL('../src/client/SidebarRoot.module.css', import.meta.url), 'utf8')
const leading = readFileSync(new URL('../src/client/HeaderLeadingControls.module.css', import.meta.url), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param source - stylesheet text.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

/**
 * Body of the last `@media (pointer: coarse)` block.
 * @param source - stylesheet text.
 * @returns the declarations inside that block.
 */
function lastCoarseBlock(source: string): string {
  const start = source.lastIndexOf('@media (pointer: coarse)')
  if (start === -1) throw new Error('stylesheet has no coarse-pointer block')
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error('unterminated coarse-pointer block')
}

describe('SidebarRoot.module.css phone drawer', () => {
  it('adds only its own rhythm to the safe-area padding the frame column already applies', () => {
    const root = declarations(drawer, ':global(html[data-mobile-shell]) .root')
    expect(root?.get('padding-top')).toBe('6px')
    expect(root?.get('padding-bottom')).toBe('8px')
  })

  it('removes the keyboard-shortcut hint that a touch drawer cannot use', () => {
    expect(declarations(drawer, ':global(html[data-mobile-shell]) .newSessionShortcut')?.get('display')).toBe('none')
  })

  it('gives panel rows a 44px touch hit while the desktop row keeps its 32px height', () => {
    expect(declarations(drawer, '.panelRow')?.get('min-height')).toBe('32px')
    expect(declarations(lastCoarseBlock(drawer), '.panelRow')?.get('min-height')).toBe('44px')
  })

  it('gives the unpin action a 44px touch hit and keeps the row label clear of it', () => {
    const fine = declarations(drawer, '.panelUnpin')
    expect(fine?.get('width')).toBe('28px')
    expect(fine?.get('height')).toBe('28px')
    expect(declarations(drawer, '.panelEntryWide .panelRow')?.get('padding-right')).toBe('38px')
    const coarse = lastCoarseBlock(drawer)
    const unpin = declarations(coarse, '.panelUnpin')
    expect(unpin?.get('top')).toBe('0')
    expect(unpin?.get('width')).toBe('44px')
    expect(unpin?.get('height')).toBe('44px')
    expect(declarations(coarse, '.panelEntryWide .panelRow')?.get('padding-right')).toBe('54px')
  })
})

describe('HeaderLeadingControls.module.css phone seat', () => {
  it('carries only the drawer trigger, as a 44px hit around the 18px glyph', () => {
    const button = declarations(leading, ':global(html[data-mobile-shell]) .iconButton')
    expect(button?.get('width')).toBe('44px')
    expect(button?.get('height')).toBe('44px')
    const glyph = declarations(leading, ':global(html[data-mobile-shell]) .iconButton svg')
    expect(glyph?.get('width')).toBe('18px')
    expect(glyph?.get('height')).toBe('18px')
    expect(declarations(leading, ':global(html[data-mobile-shell]) .controls > :not(:first-child)')?.get('display')).toBe('none')
  })
})
