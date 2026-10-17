/** The two-way git patch reader behind a working-tree comparison. */
import { describe, expect, it } from 'vitest'
import { parsePatch } from '../src/patch.ts'

describe('parsePatch', () => {
  it('reads an empty patch as no hunks', () => {
    expect(parsePatch('')).toEqual({ binary: false, hunks: [] })
  })

  it('refuses a patch whose side is binary', () => {
    expect(parsePatch('Binary files a/src/a.bin and b/src/a.bin differ\n'))
      .toEqual({ binary: true, hunks: [] })
    expect(parsePatch('\u0000\u0001')).toEqual({ binary: true, hunks: [] })
  })

  it('counts an omitted line count as one', () => {
    expect(parsePatch('@@ -3 +4 @@\n-old\n+new\n')).toEqual({
      binary: false,
      hunks: [{ oldStart: 3, oldLines: 1, newStart: 4, newLines: 1, lines: ['-old', '+new'] }],
    })
  })

  it('reads a hunk whose old side holds no lines', () => {
    expect(parsePatch('@@ -0,0 +1,2 @@\n+one\n+two\n')).toEqual({
      binary: false,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }],
    })
  })

  it('skips no-newline markers', () => {
    expect(parsePatch('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n')).toEqual({
      binary: false,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
    })
  })

  it('keeps header-like content lines inside a hunk', () => {
    // A removed line that starts with `@@` is content, counted by the hunk's own line totals.
    expect(parsePatch('@@ -1,1 +1,1 @@\n-@@ -9 +9 @@\n+plain\n')).toEqual({
      binary: false,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-@@ -9 +9 @@', '+plain'] }],
    })
  })

  it('stops a hunk after its declared line count', () => {
    expect(parsePatch('@@ -1,1 +1,1 @@\n-old\n+new\nstray\n')).toEqual({
      binary: false,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
    })
  })

  it('reads several hunks and stops at the end of the output', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+three',
      '@@ -10,2 +10,2 @@',
      ' ten',
      '-eleven',
    ].join('\n')
    expect(parsePatch(patch)).toEqual({
      binary: false,
      hunks: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' one', '-two', '+three'] },
        { oldStart: 10, oldLines: 2, newStart: 10, newLines: 2, lines: [' ten', '-eleven'] },
      ],
    })
  })
})
