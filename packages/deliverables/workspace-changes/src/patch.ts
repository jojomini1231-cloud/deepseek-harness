/** The hunks and binary refusal a two-way `git diff` patch carries. */
import type { WorkspaceDiffHunk } from './types.ts'

/** A patch's drawable facts. */
export interface ParsedPatch {
  /** True when git reported a binary side or the output carried a NUL byte. */
  binary: boolean
  /** Hunks in patch order; empty when the sides hold the same lines. */
  hunks: WorkspaceDiffHunk[]
}

/** A two-way hunk header; git omits a one-line count, which means one line rather than zero. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u

/** A hunk header's line count; an omitted count means one line. */
function count(field: string | undefined): number {
  return field === undefined ? 1 : Number(field)
}

/**
 * Split a `git diff` patch into the hunks the view draws. Body lines are
 * consumed by the header's line counts, so a content line that resembles a
 * header cannot end a hunk, and `\ No newline at end of file` markers are
 * dropped because they carry no line content. A context line counts against
 * both sides; a removal against the old side only and an addition against the
 * new one.
 * @param output - the command's decoded stdout.
 * @returns whether a side is binary and the two-way hunks in patch order.
 */
export function parsePatch(output: string): ParsedPatch {
  if (output.includes('\0')) return { binary: true, hunks: [] }
  const lines = output.split('\n')
  const hunks: WorkspaceDiffHunk[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (line.startsWith('Binary files ')) return { binary: true, hunks: [] }
    const header = HUNK_HEADER.exec(line)
    if (header === null) continue
    const oldLines = count(header[2])
    const newLines = count(header[4])
    const body: string[] = []
    let oldRemaining = oldLines
    let newRemaining = newLines
    while ((oldRemaining > 0 || newRemaining > 0) && index + 1 < lines.length) {
      index += 1
      const next = lines[index] as string
      if (next.startsWith('\\')) continue
      body.push(next)
      if (next.startsWith('-')) oldRemaining -= 1
      else if (next.startsWith('+')) newRemaining -= 1
      else {
        oldRemaining -= 1
        newRemaining -= 1
      }
    }
    hunks.push({
      oldStart: Number(header[1]),
      oldLines,
      newStart: Number(header[3]),
      newLines,
      lines: body,
    })
  }
  return { binary: false, hunks }
}
