/** Menu touch geometry: touch-sized rows on coarse pointers and a viewport-bounded card. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/Menu.module.css', import.meta.url), 'utf8')

/**
 * Declarations of one exact selector, merged in source order, keyed by property.
 * @param source - stylesheet text.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  let found: Map<string, string> | undefined
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    found ??= new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found
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

/**
 * The stylesheet with every `@media (pointer: coarse)` block removed.
 * @param source - stylesheet text.
 * @returns the declaration text a fine pointer resolves.
 */
function withoutCoarseBlocks(source: string): string {
  let result = ''
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('@media (pointer: coarse)', index)
    if (start === -1) return result + source.slice(index)
    result += source.slice(index, start)
    const open = source.indexOf('{', start)
    let depth = 0
    let end = open
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    index = end + 1
  }
  return result
}

describe('Menu.module.css touch geometry', () => {
  it('keeps the desktop option row compact and only lifts it under a coarse pointer', () => {
    expect(declarations(withoutCoarseBlocks(css), '.item')?.get('min-height')).toBe('34px')
    const coarse = lastCoarseBlock(css)
    for (const selector of ['.item', '.compactList .item', '.denseList .item']) {
      expect(declarations(coarse, selector)?.get('min-height')).toBe('44px')
    }
  })

  it('bounds the card width to the viewport for every pointer', () => {
    for (const selector of ['.list', '.submenu']) {
      expect(declarations(withoutCoarseBlocks(css), selector)?.get('max-width')).toBe('min(360px, calc(100vw - 24px))')
    }
  })
})
