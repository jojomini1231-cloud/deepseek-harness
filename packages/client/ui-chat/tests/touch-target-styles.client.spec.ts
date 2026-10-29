/** Touch geometry for message actions, reasoning rows, process group headers, and the chat tail. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const actions = readFileSync(new URL('../src/client/chat/MessageIconActions.module.css', import.meta.url), 'utf8')
const reasoning = readFileSync(new URL('../src/client/chat/ReasoningRow.module.css', import.meta.url), 'utf8')
const groupSeat = readFileSync(new URL('../src/client/chat/ChatGroupSeat.module.css', import.meta.url), 'utf8')
const chatView = readFileSync(new URL('../src/client/chat/ChatView.module.css', import.meta.url), 'utf8')

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

describe('message action row', () => {
  it('grows the row and every icon to the 44px touch floor while the desktop row stays 28px', () => {
    expect(declarations(actions, '.actions')?.get('height')).toBe('calc(28px + var(--dsh-content-font-delta, 0px))')
    expect(declarations(actions, '.action')?.get('width')).toBe('calc(28px + var(--dsh-content-font-delta, 0px))')
    const coarse = lastCoarseBlock(actions)
    expect(declarations(coarse, '.actions')?.get('height')).toBe('max(44px, calc(28px + var(--dsh-content-font-delta, 0px)))')
    expect(declarations(coarse, '.action')?.get('width')).toBe('max(44px, calc(28px + var(--dsh-content-font-delta, 0px)))')
    expect(declarations(coarse, '.action')?.get('height')).toBe('max(44px, calc(28px + var(--dsh-content-font-delta, 0px)))')
  })
})

describe('reasoning row', () => {
  it('makes the Think header a full-width 44px hit collapsed and expanded', () => {
    expect(declarations(reasoning, '.root:not([data-expanded])')?.get('height')).toBe('calc(24px + var(--dsh-content-font-delta, 0px))')
    const coarse = lastCoarseBlock(reasoning)
    expect(declarations(coarse, '.root:not([data-expanded])')?.get('height')).toBe('max(44px, calc(24px + var(--dsh-content-font-delta, 0px)))')
    expect(declarations(coarse, '.root :global([data-disclosure-row])')?.get('min-height')).toBe('max(44px, calc(24px + var(--dsh-content-font-delta, 0px)))')
  })
})

describe('process group header', () => {
  it('keeps the desktop 24px line and takes the 44px hit floor on touch', () => {
    expect(declarations(groupSeat, '.title')?.get('line-height')).toBe('calc(24px + var(--dsh-content-font-delta, 0px))')
    expect(declarations(lastCoarseBlock(groupSeat), '.title')?.get('min-height')).toBe('max(44px, calc(24px + var(--dsh-content-font-delta, 0px)))')
  })
})

describe('chat tail', () => {
  it('gives the running status the height of the 44px actions row and grows the back-to-bottom control', () => {
    const coarse = lastCoarseBlock(chatView)
    expect(declarations(coarse, '.runningContent')?.get('height')).toBe('max(44px, calc(28px + var(--dsh-content-font-delta, 0px)))')
    expect(declarations(coarse, '.toBottom')?.get('width')).toBe('44px')
    expect(declarations(coarse, '.toBottom')?.get('height')).toBe('44px')
    expect(declarations(chatView, '.toBottom')?.get('width')).toBe('34px')
  })
})
