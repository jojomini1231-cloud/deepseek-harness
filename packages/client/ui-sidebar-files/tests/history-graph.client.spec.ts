/** The history list's inline graph: pure lane layout over the loaded commits. */
import { describe, expect, it } from 'vitest'
import { layoutGraph, MAX_GRAPH_LANES } from '../src/client/history-graph.ts'
import type { GraphCommit } from '../src/client/history-graph.ts'

/** A linear history: each commit is its predecessor's child, newest first. */
const LINEAR: readonly GraphCommit[] = [
  { hash: 'c3', parents: ['c2'] },
  { hash: 'c2', parents: ['c1'] },
  { hash: 'c1', parents: [] },
]

/** A merge whose second parent joins the first parent's line at the root. */
const MERGE: readonly GraphCommit[] = [
  { hash: 'm', parents: ['a', 'b'] },
  { hash: 'a', parents: ['b'] },
  { hash: 'b', parents: [] },
]

describe('layoutGraph', () => {
  it('draws a linear history as one lane, the root ending at its dot', () => {
    const rows = layoutGraph(LINEAR)
    expect(rows.size).toBe(3)
    expect(rows.get('c3')).toEqual({
      lanes: 1,
      dot: { lane: 0, color: 0 },
      segments: [{ lane: 0, from: 0.5, to: 1, color: 0 }],
      curves: [],
    })
    // A mid-history commit has the line above its dot and the line below it.
    expect(rows.get('c2')?.segments).toEqual([
      { lane: 0, from: 0, to: 0.5, color: 0 },
      { lane: 0, from: 0.5, to: 1, color: 0 },
    ])
    // The root has no line below it.
    expect(rows.get('c1')?.segments).toEqual([{ lane: 0, from: 0, to: 0.5, color: 0 }])
    expect(rows.get('c1')?.dot).toEqual({ lane: 0, color: 0 })
  })

  it('opens a second lane for a merge and bends the edge into it', () => {
    const rows = layoutGraph(MERGE)
    expect(rows.get('m')).toEqual({
      lanes: 2,
      dot: { lane: 0, color: 0 },
      segments: [
        { lane: 0, from: 0.5, to: 1, color: 0 },
        { lane: 1, from: 0.5, to: 1, color: 1 },
      ],
      curves: [{ from: 0, to: 1, color: 1 }],
    })
    // The first parent stays on the merge's own lane; the second parent's line
    // runs on beside it until the merge point.
    const a = rows.get('a')!
    expect(a.dot).toEqual({ lane: 0, color: 0 })
    expect(a.segments).toContainEqual({ lane: 0, from: 0, to: 0.5, color: 0 })
    expect(a.segments).toContainEqual({ lane: 1, from: 0, to: 1, color: 1 })
    expect(a.curves).toEqual([{ from: 0, to: 1, color: 1 }])
    // The shared root's dot sits on the lane the curves reached.
    expect(rows.get('b')?.dot).toEqual({ lane: 1, color: 1 })
    expect(rows.get('b')?.segments).toEqual([{ lane: 1, from: 0, to: 0.5, color: 1 }])
  })

  it('opens one lane per octopus parent and gives each its own color', () => {
    const rows = layoutGraph([
      { hash: 'm', parents: ['p1', 'p2', 'p3'] },
      { hash: 'p1', parents: [] },
      { hash: 'p2', parents: [] },
      { hash: 'p3', parents: [] },
    ])
    const merge = rows.get('m')!
    expect(merge.lanes).toBe(3)
    expect(merge.curves).toEqual([
      { from: 0, to: 1, color: 1 },
      { from: 0, to: 2, color: 2 },
    ])
    expect(merge.segments).toContainEqual({ lane: 2, from: 0.5, to: 1, color: 2 })
    expect(rows.get('p2')?.dot).toEqual({ lane: 1, color: 1 })
    expect(rows.get('p3')?.dot).toEqual({ lane: 2, color: 2 })
  })

  it('caps the drawn lanes while the merge targets stay tracked', () => {
    const parents = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
    const commits: GraphCommit[] = [
      { hash: 'm', parents },
      ...parents.map(hash => ({ hash, parents: [] })),
    ]
    const rows = layoutGraph(commits)
    const merge = rows.get('m')!
    expect(merge.lanes).toBe(MAX_GRAPH_LANES)
    // Only the visible lanes draw; the widths never grow past the cap.
    expect(merge.segments.every(segment => segment.lane < MAX_GRAPH_LANES)).toBe(true)
    expect(merge.curves.every(curve => curve.to < MAX_GRAPH_LANES && curve.from < MAX_GRAPH_LANES)).toBe(true)
    expect(merge.curves).toHaveLength(MAX_GRAPH_LANES - 1)
    for (const row of rows.values()) {
      expect(row.lanes).toBeLessThanOrEqual(MAX_GRAPH_LANES)
      expect(row.dot.lane).toBeLessThan(MAX_GRAPH_LANES)
    }
    // A commit whose lane fell past the cap keeps a dot in the last visible lane.
    expect(rows.get('p8')?.dot.lane).toBe(MAX_GRAPH_LANES - 1)
  })

  it('keeps the first page lanes when the next page is appended', () => {
    const all: readonly GraphCommit[] = [
      { hash: 'm', parents: ['a', 'b'] },
      { hash: 'a', parents: ['c'] },
      { hash: 'b', parents: ['c'] },
      { hash: 'c', parents: [] },
    ]
    const first = layoutGraph(all.slice(0, 2))
    const combined = layoutGraph(all)
    // The commits already on screen keep their lane and color: the boundary
    // commit's first parent continues the same line once it is loaded.
    for (const hash of ['m', 'a']) {
      expect(combined.get(hash)?.dot).toEqual(first.get(hash)?.dot)
      expect(combined.get(hash)!.lanes).toBeGreaterThanOrEqual(first.get(hash)!.lanes)
    }
    expect(first.get('a')?.segments.some(segment => segment.lane === 0 && segment.to === 1)).toBe(false)
    expect(combined.get('a')?.segments.some(segment => segment.lane === 0 && segment.to === 1)).toBe(true)
    // The appended page's second parent lands on the lane the first page
    // reserved for it once that parent is loaded.
    expect(first.get('m')?.curves).toEqual([])
    expect(combined.get('m')?.curves).toEqual([{ from: 0, to: 1, color: 1 }])
  })

  it('reuses the dot lane when a merge parent reaches an already-open lane', () => {
    // `a`'s first parent already runs on lane one, so the second parent takes
    // the free lane its own dot left behind.
    const rows = layoutGraph([
      { hash: 'm', parents: ['a', 'b'] },
      { hash: 'a', parents: ['b', 'c'] },
      { hash: 'b', parents: [] },
      { hash: 'c', parents: [] },
    ])
    const a = rows.get('a')!
    expect(a.dot).toEqual({ lane: 0, color: 0 })
    expect(a.curves).toEqual([
      { from: 0, to: 1, color: 1 },
    ])
    expect(rows.get('c')?.dot.lane).toBe(0)
  })

  it('opens a free lane for a commit no loaded child reaches', () => {
    // A page that starts mid-history: `z` is not any open lane's parent, so it
    // takes the first free lane beside the branches already running.
    const rows = layoutGraph([
      { hash: 'm', parents: ['a', 'b'] },
      { hash: 'a', parents: [] },
      { hash: 'z', parents: [] },
      { hash: 'b', parents: [] },
    ])
    expect(rows.get('m')?.lanes).toBe(2)
    expect(rows.get('z')?.dot).toEqual({ lane: 0, color: 2 })
    // The branch on lane one keeps running under the unrelated commit.
    expect(rows.get('b')?.dot.lane).toBe(1)
  })

  it('ignores parents outside the loaded commits, as a cut page leaves them', () => {
    const rows = layoutGraph([{ hash: 'c2', parents: ['c1'] }])
    expect(rows.get('c2')).toEqual({
      lanes: 1,
      dot: { lane: 0, color: 0 },
      segments: [],
      curves: [],
    })
    expect(layoutGraph([]).size).toBe(0)
  })
})
