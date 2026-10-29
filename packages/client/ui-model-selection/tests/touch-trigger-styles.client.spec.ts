/** Model chip touch geometry: the trigger keeps its typography and grows to a 44px hit. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/ModelSelect.module.css', import.meta.url), 'utf8')

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

describe('ModelSelect.module.css touch trigger', () => {
  it('keeps the desktop 28px chip and takes the 44px touch floor under a coarse pointer', () => {
    expect(declarations(css, '.trigger')?.get('height')).toBe('28px')
    expect(declarations(lastCoarseBlock(css), '.trigger')?.get('height')).toBe('44px')
  })
})
