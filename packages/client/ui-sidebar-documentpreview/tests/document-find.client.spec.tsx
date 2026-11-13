// @vitest-environment jsdom
/**
 * Content search over a drawn document: the control that opens it, the bar and
 * its copy, the counter, stepping, closing, and what each does to the body.
 *
 * jsdom lays nothing out, so a row's offset is its number times one line height
 * and `scrollTop` holds what it is set to — the same two facts the body specs
 * supply. jsdom has no Custom Highlight API, which the search tolerates: the
 * counts, the jumps, and the controls are what these specs assert.
 */
import { createRef } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DocumentPreview } from '../src/client/DocumentPreview.tsx'
import type { DocumentPreviewFactoryProps } from '../src/client/DocumentPreview.tsx'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import { FindBar } from '../src/client/FindBar.tsx'
import type { FindBarProps } from '../src/client/FindBar.tsx'
import { harness, page, PATH, SESSION, settle, TAB_ID } from './fixtures.client.ts'

const LINE_HEIGHT = 20

const originals = {
  offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const line = this.getAttribute('data-textpreview-line')
      return line === null ? 0 : (Number(line) - 1) * LINE_HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement & { __scrollTop?: number }) { return this.__scrollTop ?? 0 },
    set(this: HTMLElement & { __scrollTop?: number }, value: number) { this.__scrollTop = value },
  })
})

afterAll(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name)
    else Object.defineProperty(HTMLElement.prototype, name, descriptor)
  }
})

afterEach(cleanup)

function body(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-textpreview-body]')
  if (element === null) throw new Error('expected the file body')
  return element
}

function field(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('[data-textpreview-find] input')
  if (input === null) throw new Error('expected the search field')
  return input
}

function counter(container: HTMLElement): HTMLElement {
  const count = container.querySelector<HTMLElement>('[data-textpreview-find-count]')
  if (count === null) throw new Error('expected the match counter')
  return count
}

function pick(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector)
  if (element === null) throw new Error(`expected ${selector}`)
  return element
}

/** Open the search over a document holding `lines`, and type `query`. */
async function search(lines: readonly string[], query: string) {
  const h = harness({ 1: page(1, lines, true) })
  const view = render(<DocumentPreview {...h.props()} />)
  await settle()
  fireEvent.click(pick(view.container, '[data-textpreview-tool="find"]'))
  fireEvent.change(field(view.container), { target: { value: query } })
  return { h, view }
}

describe('the search control', () => {
  it('is offered over a renderer that draws source lines, and opens the bar under the header', async () => {
    const h = harness({ 1: page(1, ['alpha', 'beta'], true) })
    const view = render(<DocumentPreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-find]')).toBeNull()
    const control = pick(view.container, '[data-textpreview-tool="find"]')
    expect(control.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(control)
    expect(view.container.querySelector('[data-textpreview-find]')).not.toBeNull()
    expect(control.getAttribute('aria-expanded')).toBe('true')
    // The bar takes focus, so the reader can type without reaching for the pointer.
    expect(document.activeElement).toBe(field(view.container))
    // It sits between the header and the content, not inside the scroller.
    expect(pick(view.container, '[data-textpreview-find]').nextElementSibling)
      .toBe(view.container.querySelector('[data-textpreview-content]'))
  })

  it('is not offered before content exists', async () => {
    const h = harness()
    const view = render(<DocumentPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-tool="find"]')).toBeNull()
  })

  it('is not offered by a renderer that draws no source lines', async () => {
    const h = harness({ 1: page(1, ['# title'], true) })
    const props = h.props()
    const markdown: DocumentPreviewDefinition = {
      id: 'markdown', extensions: ['md'], title: () => 'Markdown', loading: 'text-pages',
    }
    const view = render(<DocumentPreview {...props} useDocumentPreviews={selector => selector([markdown])} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-body]')?.textContent).toContain('')
    expect(view.container.querySelector('[data-textpreview-tool="find"]')).toBeNull()
  })
})

describe('the bar', () => {
  it('counts every occurrence in the loaded source, highlighting none of them as current', async () => {
    const { view } = await search(['alpha beta', 'beta gamma', 'beta'], 'beta')
    expect(counter(view.container).textContent).toBe('find.count(current=1,total=3)')
    expect(counter(view.container).hasAttribute('data-empty')).toBe(false)
  })

  it('counts a query with no occurrence as no results', async () => {
    const { view } = await search(['alpha'], 'omega')
    expect(counter(view.container).textContent).toBe('find.noMatches')
    expect(counter(view.container).hasAttribute('data-empty')).toBe(true)
    expect(pick(view.container, '[data-textpreview-find-step="next"]').hasAttribute('disabled')).toBe(true)
    expect(pick(view.container, '[data-textpreview-find-step="previous"]').hasAttribute('disabled')).toBe(true)
  })

  it('shows no counter for an empty query, and cannot step', async () => {
    const { view } = await search(['alpha'], '')
    expect(counter(view.container).textContent).toBe('')
    expect(counter(view.container).hasAttribute('data-empty')).toBe(false)
    expect(pick(view.container, '[data-textpreview-find-step="next"]').hasAttribute('disabled')).toBe(true)
  })

  it('steps to the next match and back, wrapping at both ends', async () => {
    const { view } = await search(['alpha beta', 'beta gamma', 'beta'], 'beta')
    const next = (): void => { fireEvent.click(pick(view.container, '[data-textpreview-find-step="next"]')) }
    const previous = (): void => { fireEvent.click(pick(view.container, '[data-textpreview-find-step="previous"]')) }
    next()
    expect(counter(view.container).textContent).toBe('find.count(current=2,total=3)')
    next()
    expect(counter(view.container).textContent).toBe('find.count(current=3,total=3)')
    // Past the last match the search returns to the first.
    next()
    expect(counter(view.container).textContent).toBe('find.count(current=1,total=3)')
    // Before the first it lands on the last.
    previous()
    expect(counter(view.container).textContent).toBe('find.count(current=3,total=3)')
  })

  it('steps with Enter and Shift+Enter from the field', async () => {
    const { view } = await search(['a', 'a', 'a'], 'a')
    fireEvent.keyDown(field(view.container), { key: 'Enter' })
    expect(counter(view.container).textContent).toBe('find.count(current=2,total=3)')
    fireEvent.keyDown(field(view.container), { key: 'Enter', shiftKey: true })
    expect(counter(view.container).textContent).toBe('find.count(current=1,total=3)')
  })

  it('keeps the search open but does nothing when Enter is pressed with no match', async () => {
    const { view } = await search(['alpha'], 'omega')
    fireEvent.keyDown(field(view.container), { key: 'Enter' })
    expect(counter(view.container).textContent).toBe('find.noMatches')
    expect(view.container.querySelector('[data-textpreview-find]')).not.toBeNull()
  })

  it('scrolls to the current match and records the new place', async () => {
    const { h, view } = await search(['a', 'b', 'c', 'd'], 'd')
    await settle()
    expect(body(view.container).scrollTop).toBe(3 * LINE_HEIGHT - 0)
    expect(h.instance.getSnapshot().byView[TAB_ID]?.scrollTop).toBe(body(view.container).scrollTop)
  })

  it('loads the next page for a match the loaded pages do not reach, then reveals it', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], false), 4: page(4, ['d', 'needle'], true) })
    const view = render(<DocumentPreview {...h.props()} />)
    await settle()
    fireEvent.click(pick(view.container, '[data-textpreview-tool="find"]'))
    fireEvent.change(field(view.container), { target: { value: 'needle' } })
    await settle()
    await settle()
    expect(h.read).toHaveBeenCalledWith(SESSION, PATH, 4, h.controller.signal)
    expect(counter(view.container).textContent).toBe('find.count(current=1,total=1)')
  })

  it('does not move the body again when another page arrives under the same match', async () => {
    const h = harness({ 1: page(1, ['needle', 'b'], false), 3: page(3, ['c'], true) })
    const view = render(<DocumentPreview {...h.props()} />)
    await settle()
    fireEvent.click(pick(view.container, '[data-textpreview-tool="find"]'))
    fireEvent.change(field(view.container), { target: { value: 'needle' } })
    await settle()
    expect(body(view.container).scrollTop).toBe(0)
    // The reader scrolls away, then asks for the rest of the file: the page
    // re-renders the same match, which must not pull the body back to it.
    fireEvent.scroll(body(view.container), { target: { scrollTop: 500 } })
    fireEvent.click(pick(view.container, '[data-textpreview-more]'))
    await settle()
    expect(body(view.container).scrollTop).toBe(500)
  })

  it('closes on its control, dropping the query so a reopened search starts blank', async () => {
    const { view } = await search(['alpha beta'], 'beta')
    fireEvent.click(pick(view.container, '[data-textpreview-find-close]'))
    expect(view.container.querySelector('[data-textpreview-find]')).toBeNull()
    // Focus returns to the control that opened it.
    expect(document.activeElement).toBe(view.container.querySelector('[data-textpreview-tool="find"]'))
    fireEvent.click(pick(view.container, '[data-textpreview-tool="find"]'))
    expect(field(view.container).value).toBe('')
    expect(counter(view.container).textContent).toBe('')
  })

  it('closes on Escape without also closing the navigator beside the document', async () => {
    const { view } = await search(['alpha'], 'alpha')
    // `fireEvent` reports the event's default as un-prevented by returning false.
    // The document's own Escape handling checks this flag before closing the pane.
    expect(fireEvent.keyDown(field(view.container), { key: 'Escape' })).toBe(false)
    expect(view.container.querySelector('[data-textpreview-find]')).toBeNull()
  })

  it('closes on Escape from one of its controls', async () => {
    const { view } = await search(['alpha'], 'alpha')
    fireEvent.keyDown(pick(view.container, '[data-textpreview-find-step="next"]'), { key: 'Escape' })
    expect(view.container.querySelector('[data-textpreview-find]')).toBeNull()
  })

  it('keeps the search open across another unrelated key', async () => {
    const { view } = await search(['alpha'], 'alpha')
    fireEvent.keyDown(field(view.container), { key: 'a' })
    expect(view.container.querySelector('[data-textpreview-find]')).not.toBeNull()
  })

  it('searching another query starts from the first match again', async () => {
    const { view } = await search(['a', 'a', 'a'], 'a')
    fireEvent.keyDown(field(view.container), { key: 'Enter' })
    expect(counter(view.container).textContent).toBe('find.count(current=2,total=3)')
    fireEvent.change(field(view.container), { target: { value: 'aa' } })
    expect(counter(view.container).textContent).toBe('find.noMatches')
  })
})

describe('the bar as a component', () => {
  const labels: FindBarProps['labels'] = {
    search: 'search', previous: 'previous', next: 'next', close: 'close', count: 'count',
  }

  function renderBar(overrides: Partial<FindBarProps> = {}) {
    const onQuery = vi.fn()
    const onStep = vi.fn()
    const onClose = vi.fn()
    const inputRef = createRef<HTMLInputElement>()
    const view = render(<FindBar
      query=""
      labels={labels}
      inputRef={inputRef}
      noResults={false}
      steppable
      onQuery={onQuery}
      onStep={onStep}
      onClose={onClose}
      {...overrides}
    />)
    return { view, onQuery, onStep, onClose, inputRef }
  }

  it('names its field and controls with the copy it is given', () => {
    const { view } = renderBar()
    const input = view.container.querySelector('input')
    expect(input?.getAttribute('aria-label')).toBe('search')
    expect(input?.getAttribute('placeholder')).toBe('search')
    expect(view.getByRole('button', { name: 'previous' })).toBeDefined()
    expect(view.getByRole('button', { name: 'next' })).toBeDefined()
    expect(view.getByRole('button', { name: 'close' })).toBeDefined()
  })

  it('reports the whole new query on every keystroke', () => {
    const { view, onQuery } = renderBar()
    fireEvent.change(view.container.querySelector('input') as HTMLInputElement, { target: { value: 'ab' } })
    expect(onQuery).toHaveBeenCalledWith('ab')
  })

  it('reports the direction of each step', () => {
    const { view, onStep } = renderBar()
    fireEvent.click(view.getByRole('button', { name: 'next' }))
    fireEvent.click(view.getByRole('button', { name: 'previous' }))
    expect(onStep.mock.calls).toEqual([[1], [-1]])
  })

  it('reports a close from its control and from Escape, and swallows no other key', () => {
    const { view, onClose } = renderBar()
    fireEvent.click(view.getByRole('button', { name: 'close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(view.container.querySelector('input') as HTMLInputElement, { key: 'Escape' })).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('announces the counter to assistive technology as it changes', () => {
    const { view } = renderBar({ labels: { ...labels, count: '1 of 4' } })
    const count = view.container.querySelector('[data-textpreview-find-count]')
    expect(count?.textContent).toBe('1 of 4')
    expect(count?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('a search over a renderer without drawn text', () => {
  it('is not offered while the body holds only its loading status', async () => {
    const h = harness()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof h.read>>>()
    h.read.mockReturnValueOnce(pending.promise)
    const view = render(<DocumentPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-tool="find"]')).toBeNull()
    pending.resolve(page(1, [], true))
    await settle()
    // A page past the file's last line draws nothing, so there is still no source to search.
    await waitFor(() => { expect(view.queryByRole('status')).toBeNull() })
    expect(view.container.querySelector('[data-textpreview-tool="find"]')).toBeNull()
  })
})

describe('a search over a completed byte renderer', () => {
  it('is not offered, because a byte renderer draws no source lines', async () => {
    const h = harness()
    const props: DocumentPreviewFactoryProps = {
      ...h.props(),
      useDocumentPreviews: selector => selector([{
        id: 'complete', extensions: ['md'], title: () => 'Complete', loading: 'bytes-complete',
      }]),
    }
    h.bytes.mockResolvedValue({ ok: true, value: {
      absolutePath: '/host/project/work/notes.md', version: 'v1', offset: 0, data: new Uint8Array([1]), bytes: 1, eof: true,
    } })
    const view = render(<DocumentPreview {...props} renderSlot={() => null} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-tool="find"]')).toBeNull()
  })
})
