// @vitest-environment jsdom
/**
 * The chip menu's reveal row: absent without a desktop, and one gesture that
 * dismisses the menu on success but keeps it open and announces on failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpenPathMenuRow } from '../src/client/OpenPathMenuRow.tsx'
import type { OpenPathMenuRowProps } from '../src/client/OpenPathMenuRow.tsx'
import type { OpenInAppPathFailure } from '../src/client/open-path.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)
const ABSOLUTE_PATH = '/host/project/work/clip.mp4'

interface Bench {
  props: OpenPathMenuRowProps
  onPicked: () => void
  openPath: OpenPathMenuRowProps['openPath']
  loadDesktop: OpenPathMenuRowProps['loadDesktop']
}

/**
 * Build the row's props over a desktop answer and a scripted gesture.
 * @param over - the desktop answer and the gesture the Host runs.
 * @returns the props, the dismiss callback, and the scripted gesture.
 */
function bench(over: { desktop?: boolean | null; openPath?: Bench['openPath'] } = {}): Bench {
  const desktop = createSnapshotStore<boolean | null>(over.desktop === undefined ? true : over.desktop)
  const onPicked = vi.fn()
  const loadDesktop = vi.fn(async () => {})
  const openPath = over.openPath ?? vi.fn(async () => null)
  function useDesktop<R>(select: (value: boolean | null) => R): R {
    return select(desktop.getSnapshot())
  }
  const props = {
    path: ABSOLUTE_PATH,
    onPicked,
    useOpenInAppDesktop: useDesktop,
    loadDesktop,
    openPath,
    t,
  } as Bench['props']
  return { props, onPicked, openPath, loadDesktop }
}

describe('OpenPathMenuRow', () => {
  it('renders the reveal row and dismisses the menu once the Host acknowledges', async () => {
    const b = bench()
    render(<OpenPathMenuRow {...b.props} />)
    const row = screen.getByRole('menuitem', { name: '显示文件位置' })
    await act(async () => { fireEvent.click(row) })
    expect(b.openPath).toHaveBeenCalledWith(ABSOLUTE_PATH, 'reveal')
    expect(b.onPicked).toHaveBeenCalledOnce()
    expect(screen.queryByText('无法显示文件位置，请重试')).toBeNull()
  })

  it('keeps the menu open and announces a failed reveal', async () => {
    const b = bench({ openPath: vi.fn(async (): Promise<OpenInAppPathFailure | null> => 'revealError') })
    render(<OpenPathMenuRow {...b.props} />)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '显示文件位置' })) })
    expect(b.onPicked).not.toHaveBeenCalled()
    expect(await screen.findByText('无法显示文件位置，请重试')).not.toBeNull()
  })

  it('offers nothing while the desktop answer is unknown and nothing without a desktop, asking only while unknown', () => {
    const unknown = bench({ desktop: null })
    const first = render(<OpenPathMenuRow {...unknown.props} />)
    expect(first.container.innerHTML).toBe('')
    expect(unknown.loadDesktop).toHaveBeenCalledOnce()
    cleanup()
    const absent = bench({ desktop: false })
    expect(render(<OpenPathMenuRow {...absent.props} />).container.innerHTML).toBe('')
    expect(absent.loadDesktop).not.toHaveBeenCalled()
  })
})
