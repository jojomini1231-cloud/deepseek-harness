/**
 * Source lines: the page arithmetic and the drawn row that stands for one line.
 *
 * The Host reports each page's line count, which tells a page past the file's
 * last line (`lines: 0`) from a page holding one empty line (`lines: 1`). Both
 * are read by the plain-text renderer, by the line navigator, and by the content
 * search, so the two facts live here rather than in any one domain.
 */

/**
 * Split a loaded page into its source lines.
 * @param page - loaded page with the Host's line count.
 * @returns its lines, preserving one empty line but excluding a zero-line page.
 */
export function linesOf(page: { readonly text: string; readonly lines: number }): string[] {
  return page.lines === 0 ? [] : page.text.split('\n')
}

/**
 * One drawn source line, whatever renderer drew it.
 *
 * A plain-text body marks each line with its number. A highlighted code surface
 * is itself the scrollport (`data-code-block-content`) and draws one `.line` per
 * source line in order; a code block inside a rendered document belongs to that
 * document, so it is only read in that role.
 * @param body - scrolling document body or code-content viewport.
 * @param line - 1-based source line.
 * @returns the line's element, or undefined when the renderer has not drawn it.
 */
export function lineElement(body: HTMLElement, line: number): HTMLElement | undefined {
  const plain = body.querySelector(`[data-textpreview-line="${line}"]`)
  const code = body.hasAttribute('data-code-block-content')
    ? body.querySelectorAll('pre .line').item(line - 1)
    : null
  const row = plain ?? code
  return row instanceof HTMLElement ? row : undefined
}
