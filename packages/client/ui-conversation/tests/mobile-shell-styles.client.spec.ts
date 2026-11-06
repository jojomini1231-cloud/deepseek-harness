/** Phone shell style contracts for the conversation header and the composer. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const header = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
const composer = readFileSync(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url), 'utf8')

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

describe('phone conversation header', () => {
  it('reserves the frame leading seat for the drawer trigger without padding the safe area twice', () => {
    // The frame publishes the phone seat's clearance; a phone-only header inset would add it twice.
    expect(declarations(header, '.titleRow')?.get('padding-inline-start'))
      .toBe('max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px))')
    expect(declarations(header, ':global(html[data-mobile-shell]) .headerLeading')).toBeUndefined()
    expect(declarations(header, ':global(html[data-mobile-shell]) .header')).toBeUndefined()
  })

  it('sets the one-line title at 15/22 and the subagent lineage row at 12/18', () => {
    const title = declarations(header, ':global(html[data-mobile-shell]) .crumb')
    expect(title?.get('font-size')).toBe('15px')
    expect(title?.get('line-height')).toBe('22px')
    const lineage = declarations(header, ':global(html[data-mobile-shell]) .crumbSubagent')
    expect(lineage?.get('font-size')).toBe('12px')
    expect(lineage?.get('line-height')).toBe('18px')
  })

  it('collapses the desktop-only header utilities instead of leaving them focusable', () => {
    expect(declarations(header, ':global(html[data-mobile-shell]) .headerUtilities')?.get('display')).toBe('none')
  })
})

describe('phone composer', () => {
  it('clears the bottom safe area for the whole stack including the meta row', () => {
    expect(declarations(composer, ':global(html[data-mobile-shell]) .root')?.get('padding-bottom'))
      .toBe('max(8px, var(--dsh-safe-bottom, 0px))')
  })

  it('drops the meta row while the keyboard covers it', () => {
    expect(declarations(composer, ':global(html[data-keyboard-open]) .dock')?.get('display')).toBe('none')
  })

  it('gives the attach and send circles a 44px hit without shifting them into the draft', () => {
    const coarse = lastCoarseBlock(composer)
    expect(declarations(coarse, '.add')?.get('width')).toBe('44px')
    expect(declarations(coarse, '.add')?.get('height')).toBe('44px')
    expect(declarations(coarse, '.primary')?.get('width')).toBe('44px')
    expect(declarations(coarse, '.primary')?.get('height')).toBe('44px')
    expect(declarations(coarse, '.primary')?.get('transform')).toBe('none')
  })
})
