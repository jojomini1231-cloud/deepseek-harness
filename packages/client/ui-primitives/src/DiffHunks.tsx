/**
 * Numbered, highlighted hunks with the project's two comparison layouts: one
 * unified column, or the old and new sides side by side.
 *
 * The renderer owns layout only — the owner supplies the caller's path (for
 * highlighting), the already-computed hunks, and the localized facts it wants
 * stated above them. A one-sided comparison stays unified unless the caller
 * sets {@link DiffHunksProps.splitOneSided}.
 */
import { useMemo, useRef } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { languageForPath, useCodeHighlighter } from './code-highlighting.ts'
import type { CodeHighlighter, HighlightSpan } from './code-highlighting.ts'
import css from './DiffHunks.module.css'

/** Maximum rendered lines per comparison. */
export const MAX_DIFF_HUNK_LINES = 5000

/** One served hunk: its two starting positions and its prefixed body lines. */
export interface DiffHunkLines {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Body lines in order, each prefixed with `+`, `-`, or a space. */
  lines: readonly string[]
}

/** One drawn line of a hunk with its line numbers on each side. */
export interface DiffRow {
  kind: 'add' | 'del' | 'context'
  old: number | undefined
  new: number | undefined
  text: string
}

/** One side-by-side row: the old side, the new side, or both. */
export interface SplitRow {
  left?: { no: number; text: string; kind: 'del' | 'context' }
  right?: { no: number; text: string; kind: 'add' | 'context' }
}

/** Localized facts drawn above the hunks. */
export interface DiffHunksLabels {
  /** Shown when the line comparison exceeded its budget. */
  coarse: string
  /** Shown when the comparison was cut at the rendered-line cap. */
  truncated: (count: string) => string
}

/** The comparison's inputs. */
export interface DiffHunksProps {
  /** The compared path, used only to choose a highlighter. */
  path: string
  /** The hunks to draw, in file order. */
  hunks: readonly DiffHunkLines[]
  /** Draw the two sides side by side; one-sided comparisons ignore it. */
  split: boolean
  /** Wrap long lines instead of scrolling them. */
  wrap?: boolean | undefined
  /** A localized fact the owner wants above the hunks, such as a created-file note. */
  note?: string | undefined
  /** Whether every line was shown as replaced. */
  coarse?: boolean | undefined
  /**
   * Keep the requested side-by-side layout even when only one side has lines,
   * leaving the other side empty. Absent, a one-sided comparison stays unified.
   */
  splitOneSided?: boolean | undefined
  labels: DiffHunksLabels
}

interface HunkHighlights {
  old: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
  new: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
}

/**
 * Number a hunk's lines: context lines count on both sides, deletions on the
 * old side, additions on the new side.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function hunkRows(hunk: DiffHunkLines): DiffRow[] {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': return { kind: 'add', old: undefined, new: newNo++, text }
      case '-': return { kind: 'del', old: oldNo++, new: undefined, text }
      default: return { kind: 'context', old: oldNo++, new: newNo++, text }
    }
  })
}

/**
 * Pair a hunk's lines for the side-by-side view: each run of deletions is
 * aligned with the run of additions that follows it, row by row, and context
 * lines sit on both sides.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function splitRows(hunk: DiffHunkLines): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: NonNullable<SplitRow['left']>[] = []
  let adds: NonNullable<SplitRow['right']>[] = []
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at]
      const right = adds[at]
      rows.push({ ...left === undefined ? {} : { left }, ...right === undefined ? {} : { right } })
    }
    dels = []
    adds = []
  }
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'del') dels.push({ no: row.old as number, text: row.text, kind: 'del' })
    else if (row.kind === 'add') adds.push({ no: row.new as number, text: row.text, kind: 'add' })
    else {
      flush()
      rows.push({ left: { no: row.old as number, text: row.text, kind: 'context' }, right: { no: row.new as number, text: row.text, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/**
 * The hunks to draw, cut at {@link MAX_DIFF_HUNK_LINES} lines in total.
 * @param hunks - served hunks.
 * @returns the hunks with the last one shortened as needed, and whether anything was cut.
 */
export function renderedHunks(hunks: readonly DiffHunkLines[]): { hunks: readonly DiffHunkLines[]; truncated: boolean } {
  let budget = MAX_DIFF_HUNK_LINES
  const kept: DiffHunkLines[] = []
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) })
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
}

function highlightedSide(rows: readonly DiffRow[], side: 'old' | 'new', highlighter: CodeHighlighter): HunkHighlights['old'] {
  const source = rows.flatMap((row) => {
    const no = row[side]
    return no === undefined ? [] : [{ no, text: row.text }]
  })
  if (source.length === 0) return new Map()
  const highlighted = highlighter(source.map(line => line.text).join('\n'))
  if (highlighted === undefined) return undefined
  return new Map(source.map((line, index) => {
    // Shiki omits one terminal empty token row; retain an aligned empty run for that source line.
    return [line.no, highlighted[index] ?? []]
  }))
}

function hunkHighlights(hunk: DiffHunkLines, highlighter: CodeHighlighter): HunkHighlights {
  const rows = hunkRows(hunk)
  return { old: highlightedSide(rows, 'old', highlighter), new: highlightedSide(rows, 'new', highlighter) }
}

function DiffText({ text, spans }: { text: string; spans: readonly HighlightSpan[] | undefined }): ReactNode {
  return <span className={css.text} data-diff-code={spans === undefined ? undefined : ''}>
    {spans === undefined ? text : spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)}
  </span>
}

/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
function splitRowKind(row: SplitRow): DiffRow['kind'] {
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context'
}

function hunkHeader(hunk: DiffHunkLines): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * The side-by-side view without wrapping: two columns that clip their long
 * lines and scroll together on both axes, so a long line on one side never
 * runs under the other and both sides show the same rows and columns of text.
 * Every line is one fixed-height row, which keeps the sides aligned.
 * The columns suppress elastic overscroll while retaining native in-range scrolling.
 */
function SplitColumns({ hunks, highlights }: { hunks: readonly DiffHunkLines[]; highlights: readonly HunkHighlights[] }): ReactNode {
  const paired = useMemo(() => hunks.map(hunk => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null })
  const offsets = useRef({ left: { scrollLeft: 0, scrollTop: 0 }, right: { scrollLeft: 0, scrollTop: 0 } })
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): void => {
    const peer = side === 'left' ? 'right' : 'left'
    const other = columns.current[peer]
    /* v8 ignore next -- Both column refs are attached before browser scroll events can run. */
    if (other === null) return
    for (const axis of ['scrollLeft', 'scrollTop'] as const) {
      const value = event.currentTarget[axis]
      if (offsets.current[side][axis] === value) continue
      offsets.current[side][axis] = value
      other[axis] = value
      // Record the browser-clamped offset so its scroll event cannot pull the source back.
      offsets.current[peer][axis] = other[axis]
    }
  }
  return (
    <div className={css.columns}>
      {(['left', 'right'] as const).map(side => (
        <div key={side} className={css.column} data-diff-side={side}
          ref={(element) => { columns.current[side] = element }} onScroll={follow(side)}>
          {paired.map((hunk, position) => (
            <section key={position} className={css.hunk}>
              <div className={css.hunkHeader} data-diff-hunk-header>{hunk.header}</div>
              {hunk.rows.map((row, at) => {
                const cell = row[side]
                const spans = cell === undefined ? undefined : highlights[position]?.[side === 'left' ? 'old' : 'new']?.get(cell.no)
                return (
                  <div key={at} className={`${css.sideLine} ${cell === undefined ? css.empty : css[cell.kind]}`} data-diff-line={splitRowKind(row)}>
                    <span className={css.number}>{cell?.no ?? ''}</span>
                    <DiffText text={cell?.text ?? ''} spans={spans} />
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Render one comparison's hunks.
 * @param props - the path, hunks, layout choice, optional notes, and localized facts.
 * @returns the numbered hunks in the requested layout.
 */
export function DiffHunks({
  path, hunks, split, wrap = false, note, coarse = false, splitOneSided = false, labels,
}: DiffHunksProps): ReactNode {
  const hasAdditions = hunks.some(hunk => hunk.lines.some(line => line.startsWith('+')))
  const hasDeletions = hunks.some(hunk => hunk.lines.some(line => line.startsWith('-')))
  const oneSided = hasAdditions !== hasDeletions
  const sideBySide = split && (splitOneSided || !oneSided)
  const rendered = useMemo(() => renderedHunks(hunks), [hunks])
  const highlighter = useCodeHighlighter(languageForPath(path))
  const highlights = useMemo(() => rendered.hunks.map(hunk => hunkHighlights(hunk, highlighter)), [rendered, highlighter])
  return (
    <div
      className={css.body}
      data-review-view={sideBySide ? 'split' : 'unified'}
      data-review-wrap={wrap || undefined}
    >
      {note !== undefined && <p className={css.note} data-diff-note={rendered.hunks.length === 0 ? 'empty' : 'metadata'}>{note}</p>}
      {coarse && <p className={css.note} data-diff-coarse>{labels.coarse}</p>}
      {rendered.truncated && (
        <p className={css.note} data-diff-truncated>{labels.truncated(String(MAX_DIFF_HUNK_LINES))}</p>
      )}
      {sideBySide && !wrap ? <SplitColumns hunks={rendered.hunks} highlights={highlights} /> : rendered.hunks.map((hunk, position) => {
        const highlighted = highlights[position]
        return <section key={position} className={css.hunk}>
          <div className={css.hunkHeader} data-diff-hunk-header>{hunkHeader(hunk)}</div>
          {sideBySide ? splitRows(hunk).map((row, at) => (
            <div key={at} className={css.splitLine} data-diff-line={splitRowKind(row)}>
              <span className={`${css.cell} ${row.left === undefined ? css.empty : css[row.left.kind]}`}>
                <span className={css.number}>{row.left?.no ?? ''}</span>
                <DiffText text={row.left?.text ?? ''} spans={row.left === undefined ? undefined : highlighted?.old?.get(row.left.no)} />
              </span>
              <span className={`${css.cell} ${row.right === undefined ? css.empty : css[row.right.kind]}`}>
                <span className={css.number}>{row.right?.no ?? ''}</span>
                <DiffText text={row.right?.text ?? ''} spans={row.right === undefined ? undefined : highlighted?.new?.get(row.right.no)} />
              </span>
            </div>
          )) : hunkRows(hunk).map((row, at) => (
            <div key={at} className={`${css.line} ${css[row.kind]}`} data-diff-line={row.kind}>
              <span className={css.number}>{row.old ?? ''}</span>
              <span className={css.number}>{row.new ?? ''}</span>
              <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
              <DiffText text={row.text} spans={row.kind === 'add' ? highlighted?.new?.get(row.new as number) : highlighted?.old?.get(row.old as number)} />
            </div>
          ))}
        </section>
      })}
    </div>
  )
}
