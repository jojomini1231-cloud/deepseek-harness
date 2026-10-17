/**
 * The retention contract: one abort listener per signal covering every view that
 * signal owns — a workbench tab's chips — so an abort forgets each view's own
 * bucket, and disposing the plugin forgets everything still retained.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { retainDocumentViews } from '../src/client/document/tab-lifetime.ts'

describe('retainDocumentViews', () => {
  /**
   * Boot a plugin that owns the retention callback.
   * @returns the callback, the forget recorder it closes over, and the plugin's disposal.
   */
  async function boot(): Promise<{
    retain: ReturnType<typeof retainDocumentViews>
    forgotten: string[]
    forget: (viewKey: string) => void
    dispose: () => Promise<void>
  }> {
    let retain: ReturnType<typeof retainDocumentViews> | undefined
    const forgotten: string[] = []
    const forget = (viewKey: string): void => { forgotten.push(viewKey) }
    const ctx = new Context()
    const fiber: Fiber = ctx.plugin({
      inject: [],
      apply(plugin: Context): void { retain = retainDocumentViews(plugin) },
    })
    onTestFinished(async () => { await fiber.dispose() })
    await fiber.await()
    return { retain: retain!, forgotten, forget, dispose: async () => { await fiber.dispose() } }
  }

  it('forgets every view a shared signal owns when the signal aborts', async () => {
    const { retain, forgotten, forget } = await boot()
    const owner = new AbortController()
    retain('/work/a.png', owner.signal, forget)
    retain('/work/b.png', owner.signal, forget)
    expect(forgotten).toEqual([])
    owner.abort()
    expect(forgotten.sort()).toEqual(['/work/a.png', '/work/b.png'])
  })

  it('forgets only the aborted view when views hold separate signals', async () => {
    const { retain, forgotten, forget } = await boot()
    const first = new AbortController()
    const second = new AbortController()
    retain('/work/a.png', first.signal, forget)
    retain('/work/b.png', second.signal, forget)
    first.abort()
    expect(forgotten).toEqual(['/work/a.png'])
    second.abort()
    expect(forgotten).toEqual(['/work/a.png', '/work/b.png'])
  })

  it('forgets a view whose signal already ended', async () => {
    const { retain, forgotten, forget } = await boot()
    const owner = new AbortController()
    owner.abort()
    retain('/work/a.png', owner.signal, forget)
    expect(forgotten).toEqual(['/work/a.png'])
  })

  it('keeps one listener across repeated holds of the same view', async () => {
    const { retain, forgotten, forget } = await boot()
    const owner = new AbortController()
    retain('/work/a.png', owner.signal, forget)
    retain('/work/a.png', owner.signal, forget)
    owner.abort()
    expect(forgotten).toEqual(['/work/a.png'])
  })

  it('forgets every retained view when the plugin is disposed', async () => {
    const { retain, forgotten, forget, dispose } = await boot()
    const owner = new AbortController()
    const other = new AbortController()
    retain('/work/a.png', owner.signal, forget)
    retain('/work/b.png', other.signal, forget)
    expect(forgotten).toEqual([])
    await dispose()
    expect(forgotten.sort()).toEqual(['/work/a.png', '/work/b.png'])
    // A live signal stays live: disposal releases state without ending lifetimes.
    expect(owner.signal.aborted).toBe(false)
  })
})
