/**
 * Content search inside one previewed document.
 *
 * The loaded source is what a search addresses. A renderer that draws one row per
 * source line — plain text and highlighted code — is searched line by line in the
 * source it was given, so the count is exact and does not move as the same text is
 * re-drawn by incremental highlighting. Each occurrence also knows its source
 * line, which is how the body reveals it with the same scroll the line navigator
 * uses.
 *
 * Painting uses the CSS Custom Highlight API. Its registry is global to the
 * document and its ranges live outside React's tree, so the body's nodes are never
 * rewritten and a renderer's own decorations survive the search. A match's range
 * is built from the row drawn for its line by counting characters across that
 * row's text nodes, because a tokenized line splits one source word across
 * several. An engine without the API still counts and jumps; only the paint is
 * skipped.
 */
import { lineElement, linesOf } from './source-lines.ts'

/** Registry name painting every match; styled in `FindBar.module.css`. */
export const FIND_HIGHLIGHT = 'dsw-document-find'

/** Registry name painting the current match over the others; styled in `FindBar.module.css`. */
export const FIND_ACTIVE_HIGHLIGHT = 'dsw-document-find-active'

/** The source a search reads: loaded pages in file order. */
export interface FindSource {
  readonly offset: number
  readonly text: string
  readonly lines: number
}

/** One occurrence of the query in the loaded source. */
export interface FindMatch {
  /** 1-based source line holding the occurrence. */
  readonly line: number
  /** Zero-based character offset within that line's text. */
  readonly start: number
  /** Occurrence length in characters. */
  readonly length: number
}

/**
 * Every occurrence of a query in the loaded pages, in reading order.
 *
 * Case is folded so a query finds its own spelling; occurrences on one line are
 * scanned forward from the end of the previous one, so they never overlap.
 * @param pages - loaded pages in source order.
 * @param query - what the reader typed; blank matches nothing.
 * @returns one entry per occurrence.
 */
export function findInPages(pages: readonly FindSource[], query: string): readonly FindMatch[] {
  const needle = query.toLowerCase()
  if (needle === '') return []
  const matches: FindMatch[] = []
  for (const page of pages) {
    for (const [index, line] of linesOf(page).entries()) {
      const haystack = line.toLowerCase()
      for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
        matches.push({ line: page.offset + index, start: at, length: needle.length })
      }
    }
  }
  return matches
}

/**
 * The match a view shows as current, clamped to the matches it has now.
 *
 * The stored index outlives the query that produced it, so a shorter query
 * result must not point past its end.
 * @param stored - index the view remembered.
 * @param total - matches found for the current query.
 * @returns the index to show, or `-1` when there is no match.
 */
export function currentMatch(stored: number, total: number): number {
  return total === 0 ? -1 : Math.min(stored, total - 1)
}

/**
 * The index one step lands on, wrapping at both ends of the matches found.
 * @param index - the match shown now, or `-1` when none is.
 * @param delta - `1` for the next match, `-1` for the previous one.
 * @param total - matches found for the current query.
 * @returns the match to show, or `-1` when there is none to step to.
 */
export function steppedMatch(index: number, delta: 1 | -1, total: number): number {
  if (total === 0) return -1
  return ((index + delta) % total + total) % total
}

/**
 * The range covering one occurrence inside the row drawn for its line.
 * @param row - the drawn row for the occurrence's line.
 * @param start - zero-based character offset within the line's text.
 * @param length - characters to cover.
 * @returns the range, or undefined when the drawn text is shorter than the source.
 */
export function rangeInRow(row: HTMLElement, start: number, length: number): Range | undefined {
  const document = row.ownerDocument
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let at = 0
  let opened = false
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    // `SHOW_TEXT` admits text nodes only, which `data` addresses without the
    // nullable `nodeValue` a general node carries.
    const end = at + (node as Text).data.length
    if (!opened && start < end) {
      range.setStart(node, start - at)
      opened = true
    }
    if (opened && start + length <= end) {
      range.setEnd(node, start + length - at)
      return range
    }
    at = end
  }
  return undefined
}

/** The CSS Custom Highlight API calls this module makes. */
interface FindHighlightApi {
  set(name: string, ranges: readonly Range[]): void
  clear(name: string): void
}

/**
 * The document's highlight registry, or nothing on an engine without the API.
 * @returns the painting operations, or undefined.
 */
function highlightApi(): FindHighlightApi | undefined {
  if (typeof CSS === 'undefined' || typeof Highlight === 'undefined') return undefined
  return {
    set: (name, ranges) => { CSS.highlights.set(name, new Highlight(...ranges)) },
    clear: (name) => { CSS.highlights.delete(name) },
  }
}

/**
 * The range that paints one occurrence, as far as its line is drawn.
 * @param body - the scrollport holding the drawn document.
 * @param match - the occurrence.
 * @returns its range, or undefined while its line is not drawn.
 */
function rangeOf(body: HTMLElement, match: FindMatch): Range | undefined {
  const row = lineElement(body, match.line)
  return row === undefined ? undefined : rangeInRow(row, match.start, match.length)
}

/**
 * Paint every drawn occurrence, and the current one over them.
 * @param body - the scrollport holding the drawn document.
 * @param matches - occurrences in reading order.
 * @param active - index of the revealed occurrence, or `-1` for none.
 */
export function paintFind(body: HTMLElement, matches: readonly FindMatch[], active: number): void {
  const api = highlightApi()
  if (api === undefined) return
  const ranges: Range[] = []
  for (const match of matches) {
    const range = rangeOf(body, match)
    if (range !== undefined) ranges.push(range)
  }
  if (ranges.length === 0) api.clear(FIND_HIGHLIGHT)
  else api.set(FIND_HIGHLIGHT, ranges)
  const current = matches[active] === undefined ? undefined : rangeOf(body, matches[active])
  if (current === undefined) api.clear(FIND_ACTIVE_HIGHLIGHT)
  else api.set(FIND_ACTIVE_HIGHLIGHT, [current])
}

/** Drop both highlights, for a closed search or a body that no longer draws the document. */
export function clearFind(): void {
  const api = highlightApi()
  if (api === undefined) return
  api.clear(FIND_HIGHLIGHT)
  api.clear(FIND_ACTIVE_HIGHLIGHT)
}

/**
 * Bring one occurrence into view, centred in the scrollport, by its row's offset
 * — the coordinate the line navigator scrolls to.
 * @param body - the scrollport holding the drawn document.
 * @param match - the occurrence to reveal; the renderer has drawn its line.
 */
export function revealMatch(body: HTMLElement, match: FindMatch): void {
  const row = lineElement(body, match.line)
  /* v8 ignore next -- a match lies inside a loaded page, whose lines the renderer has drawn. */
  if (row === undefined) return
  body.scrollTop = Math.max(0, row.offsetTop - (body.clientHeight - row.offsetHeight) / 2)
}
