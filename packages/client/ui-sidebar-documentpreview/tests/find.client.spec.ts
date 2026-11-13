// @vitest-environment jsdom
/**
 * What a search finds and how it paints.
 *
 * The occurrences themselves are source arithmetic and need no DOM. Painting and
 * revealing do: the range is built from the row a renderer drew, which is where a
 * tokenized line splits one source word across several text nodes. jsdom exposes
 * no Custom Highlight API and no layout, so the registry is stubbed and a row's
 * offset is supplied, as the body specs already do for the line navigator.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFind, currentMatch, findInPages, paintFind, rangeInRow, revealMatch, steppedMatch } from '../src/client/find.ts'
import type { FindMatch, FindSource } from '../src/client/find.ts'

const LINE_HEIGHT = 20

const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const line = this.getAttribute('data-textpreview-line')
      return line === null ? 0 : (Number(line) - 1) * LINE_HEIGHT
    },
  })
})

afterAll(() => {
  if (offsetTop === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop')
  else Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop)
})

// jsdom has no scroll model; a scrollport holds whatever it is set to.
Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
  configurable: true,
  get(this: HTMLElement & { __scrollTop?: number }) { return this.__scrollTop ?? 0 },
  set(this: HTMLElement & { __scrollTop?: number }, value: number) { this.__scrollTop = value },
})

/** The ranges a stubbed Custom Highlight API holds under one name. */
function painted(registry: Map<string, StubHighlight>, name: string): string[] | undefined {
  return registry.get(name)?.ranges.map(range => range.toString())
}

/** A stubbed Custom Highlight API, which records what a search painted. */
function highlightRegistry(): Map<string, StubHighlight> {
  const registry = new Map<string, StubHighlight>()
  vi.stubGlobal('CSS', { highlights: registry })
  vi.stubGlobal('Highlight', StubHighlight)
  return registry
}

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => { vi.unstubAllGlobals() })

/** A drawn plain-text body: one row per line, numbered as the renderer marks them. */
function drawnBody(lines: readonly string[]): HTMLElement {
  const body = document.createElement('div')
  for (const [index, text] of lines.entries()) {
    const row = document.createElement('div')
    row.setAttribute('data-textpreview-line', String(index + 1))
    row.textContent = `${text}\n`
    body.append(row)
  }
  document.body.append(body)
  return body
}

/** The `Highlight` the search constructs, reduced to the ranges it was given. */
class StubHighlight {
  constructor(...ranges: Range[]) { this.ranges = ranges }
  readonly ranges: readonly Range[]
}

const page = (offset: number, lines: readonly string[]): FindSource => ({ offset, text: lines.join('\n'), lines: lines.length })

describe('findInPages', () => {
  it('finds every occurrence in reading order, with the line each sits on', () => {
    const pages = [page(1, ['alpha beta', 'gamma']), page(3, ['beta again'])]
    expect(findInPages(pages, 'beta')).toEqual([
      { line: 1, start: 6, length: 4 },
      { line: 3, start: 0, length: 4 },
    ])
  })

  it('folds case both ways, so the query need not match the source spelling', () => {
    expect(findInPages([page(1, ['Beta BETA beta'])], 'bEtA')).toEqual([
      { line: 1, start: 0, length: 4 },
      { line: 1, start: 5, length: 4 },
      { line: 1, start: 10, length: 4 },
    ])
  })

  it('counts occurrences on one line forward from the previous end, so they never overlap', () => {
    expect(findInPages([page(1, ['aaaa'])], 'aa')).toEqual([
      { line: 1, start: 0, length: 2 },
      { line: 1, start: 2, length: 2 },
    ])
  })

  it('matches nothing for a blank query or one the source does not hold', () => {
    expect(findInPages([page(1, ['alpha'])], '')).toEqual([])
    expect(findInPages([page(1, ['alpha'])], 'omega')).toEqual([])
    expect(findInPages([], 'alpha')).toEqual([])
  })

  it('skips a page past the last line, which the Host reports with a zero count', () => {
    expect(findInPages([{ offset: 4, text: '', lines: 0 }], '')).toEqual([])
  })
})

describe('currentMatch', () => {
  it('clamps a remembered index to the matches found now', () => {
    expect(currentMatch(0, 3)).toBe(0)
    expect(currentMatch(2, 3)).toBe(2)
    // A shorter result must not point past its end.
    expect(currentMatch(5, 2)).toBe(1)
    expect(currentMatch(0, 0)).toBe(-1)
  })
})

describe('steppedMatch', () => {
  it('steps forward and backward, wrapping at both ends', () => {
    expect(steppedMatch(0, 1, 3)).toBe(1)
    expect(steppedMatch(2, 1, 3)).toBe(0)
    expect(steppedMatch(0, -1, 3)).toBe(2)
    expect(steppedMatch(1, -1, 3)).toBe(0)
  })

  it('has nowhere to step without a match', () => {
    expect(steppedMatch(0, 1, 0)).toBe(-1)
  })
})

describe('rangeInRow', () => {
  it('covers one node of a plain row', () => {
    const row = drawnBody(['alpha beta']).firstElementChild as HTMLElement
    const range = rangeInRow(row, 6, 4)
    expect(range?.toString()).toBe('beta')
  })

  it('counts offsets across the text nodes a tokenized row splits the line into', () => {
    const row = document.createElement('div')
    row.append('const ', 'name', ' = 1\n')
    document.body.append(row)
    expect(rangeInRow(row, 6, 4)?.toString()).toBe('name')
    // An occurrence starting in one node and ending inside the next is one range.
    const spanning = rangeInRow(row, 4, 3)
    expect(spanning?.toString()).toBe('t n')
  })

  it('finds nothing when the drawn text is shorter than the source it came from', () => {
    const row = document.createElement('div')
    row.textContent = 'ab'
    expect(rangeInRow(row, 1, 4)).toBeUndefined()
  })
})

describe('paintFind', () => {
  it('paints every drawn occurrence, and the current one over them', () => {
    const registry = highlightRegistry()
    const body = drawnBody(['alpha beta', 'beta gamma'])
    const matches = findInPages([page(1, ['alpha beta', 'beta gamma'])], 'beta')
    paintFind(body, matches, 1)
    expect(painted(registry, 'dsw-document-find')).toEqual(['beta', 'beta'])
    expect(painted(registry, 'dsw-document-find-active')).toEqual(['beta'])
  })

  it('paints only the lines a renderer has drawn so far, and still reveals the current one', () => {
    const registry = highlightRegistry()
    const body = drawnBody(['alpha beta'])
    const matches = findInPages([page(1, ['alpha beta', 'beta gamma'])], 'beta')
    paintFind(body, matches, 1)
    // The second page's row is not drawn, so nothing of it is painted; the
    // current match has no range either, which clears the layer rather than
    // leaving the previous one behind.
    expect(painted(registry, 'dsw-document-find')).toEqual(['beta'])
    expect(registry.has('dsw-document-find-active')).toBe(false)
  })

  it('clears both layers when nothing matches or no occurrence is current', () => {
    const registry = highlightRegistry()
    const body = drawnBody(['alpha'])
    registry.set('dsw-document-find', new StubHighlight())
    registry.set('dsw-document-find-active', new StubHighlight())
    paintFind(body, [], -1)
    expect(registry.has('dsw-document-find')).toBe(false)
    expect(registry.has('dsw-document-find-active')).toBe(false)
    const matches = findInPages([page(1, ['alpha'])], 'alpha')
    paintFind(body, matches, -1)
    expect(painted(registry, 'dsw-document-find')).toEqual(['alpha'])
    expect(registry.has('dsw-document-find-active')).toBe(false)
  })

  it('leaves an engine without the Custom Highlight API counting and jumping', () => {
    const body = drawnBody(['alpha'])
    const matches = findInPages([page(1, ['alpha'])], 'alpha')
    // No throw, and no registry to read: the API simply is not there.
    expect(() => { paintFind(body, matches, 0) }).not.toThrow()
    expect(() => { clearFind() }).not.toThrow()
  })

  it('drops both layers on close', () => {
    const registry = highlightRegistry()
    registry.set('dsw-document-find', new StubHighlight())
    registry.set('dsw-document-find-active', new StubHighlight())
    clearFind()
    expect([...registry.keys()]).toEqual([])
  })
})

describe('revealMatch', () => {
  it('centres the occurrence\'s row in the scrollport, by the row\'s own offset', () => {
    const body = drawnBody(['a', 'b', 'c', 'd', 'e'])
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 100 })
    const matches = findInPages([page(1, ['a', 'b', 'c', 'd', 'e'])], 'd')
    const match = matches[0] as FindMatch
    revealMatch(body, match)
    // Row 4 sits at 60px; centring a 100px viewport leaves 10px.
    expect(body.scrollTop).toBe(10)
  })

  it('stops at the top rather than scrolling above the document', () => {
    const body = drawnBody(['a', 'b'])
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 400 })
    revealMatch(body, findInPages([page(1, ['a', 'b'])], 'a')[0] as FindMatch)
    expect(body.scrollTop).toBe(0)
  })
})
