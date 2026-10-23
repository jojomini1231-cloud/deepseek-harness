/** The hunks and binary refusal a two-way `git diff` patch carries, and the context count a comparison asks git for. */
import type { WorkspaceDiffHunk } from './types.ts'

/** Unified-diff context lines a comparison carries when it covers the changed hunks only. */
export const CONTEXT_LINES = 3

/**
 * Context lines a whole-file comparison asks git for at the least.
 *
 * git emits no more context than a side holds, so the count is a request
 * ceiling rather than an output size. A patch line costs at least its prefix
 * and newline, so a patch that fits the output cap holds at most half that cap
 * in lines: {@link contextFlag} asks for one context line per two admitted
 * bytes, which covers every line of any patch the caps let through whole. This
 * floor keeps the request large when a deployment lowers the cap.
 */
export const COMPLETE_CONTEXT_LINES = 1_000_000

/**
 * The `-U` flag one comparison passes to git.
 * @param complete - true when the view asked to cover the whole file.
 * @param maxPatchBytes - bytes one patch command may collect before its read is refused as truncated.
 * @returns the flag carrying the context count for that comparison.
 */
export function contextFlag(complete: boolean | undefined, maxPatchBytes: number): string {
  return `-U${complete === true ? Math.max(COMPLETE_CONTEXT_LINES, Math.ceil(maxPatchBytes / 2)) : CONTEXT_LINES}`
}

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
