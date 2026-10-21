/** The history list's inline commit graph: layered lanes, dots, and parent edges. */
import { describe, expect, it } from 'vitest'
import { MAX_GRAPH_LANES, layoutGraph } from '../src/client/history-graph.ts'
import type { GraphCommit, GraphEdge, GraphRow } from '../src/client/history-graph.ts'

/** A linear history: each commit is its predecessor's child, newest first. */
const LINEAR: readonly GraphCommit[] = [
  { hash: 'c3', parents: ['c2'] },
  { hash: 'c2', parents: ['c1'] },
  { hash: 'c1', parents: [] },
]

/**
 * A branch merged back into the mainline that it forked from: the merge opens
 * a side lane and the branch's tip meets the mainline commit it branched from
 * at that commit's dot.
 */
const FORK_MERGE: readonly GraphCommit[] = [
  { hash: 'm', parents: ['main1', 'side2'] },
  { hash: 'main1', parents: ['main0'] },
  { hash: 'side2', parents: ['side1'] },
  { hash: 'side1', parents: ['main0'] },
  { hash: 'main0', parents: [] },
]

/** The row's drawing, asserted to exist so a missing hash reads as the failure it is. */
function rowOf(rows: ReadonlyMap<string, GraphRow>, hash: string): GraphRow {
  const row = rows.get(hash)
  expect(row, `row ${hash}`).toBeDefined()
  return row!
}

/** Every edge of a row, in drawing order. */
function edgesOf(row: GraphRow): readonly GraphEdge[] {
  return row.edges
}

/** The lanes a row's edges occupy, via either end. */
function lanesOf(row: GraphRow): number[] {
  return row.edges.flatMap(edge => [edge.fromLane, edge.toLane])
}

describe('layoutGraph', () => {
  it('draws a linear history on one vertical lane, ending at the root', () => {
    const layout = layoutGraph(LINEAR)
    expect(layout.lanes).toBe(1)
    expect([...layout.rows.keys()]).toEqual(['c3', 'c2', 'c1'])
    const tip = rowOf(layout.rows, 'c3')
    // A tip has no line above it; its first parent continues the same lane.
    expect(tip.node).toEqual({ lane: 0, color: 0 })
    expect(edgesOf(tip)).toEqual([{ fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 }])
    const middle = rowOf(layout.rows, 'c2')
    expect(middle.node).toEqual({ lane: 0, color: 0 })
    expect(edgesOf(middle)).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 },
    ])
    // The root's line ends at its dot.
    expect(edgesOf(rowOf(layout.rows, 'c1'))).toEqual([{ fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 }])
  })

  it('opens a second lane at a fork and draws the fork as a diagonal', () => {
    const layout = layoutGraph(FORK_MERGE)
    expect(layout.lanes).toBe(2)
    const merge = rowOf(layout.rows, 'm')
    expect(merge.node).toEqual({ lane: 0, color: 0 })
    // The first parent stays on the merge's lane; the side parent opens lane 1
    // in its own hue and the edge leaving the dot is the diagonal.
    expect(edgesOf(merge)).toEqual([
      { fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 },
      { fromLane: 0, toLane: 1, from: 0.5, to: 1, color: 1 },
    ])
    // The side branch keeps its lane and hue through its own commits.
    expect(rowOf(layout.rows, 'main1').node).toEqual({ lane: 0, color: 0 })
    expect(rowOf(layout.rows, 'side2').node).toEqual({ lane: 1, color: 1 })
    expect(edgesOf(rowOf(layout.rows, 'side2'))).toEqual([
      { fromLane: 1, toLane: 1, from: 0, to: 0.5, color: 1 },
      { fromLane: 0, toLane: 0, from: 0, to: 1, color: 0 },
      { fromLane: 1, toLane: 1, from: 0.5, to: 1, color: 1 },
    ])
    // The branch's tip keeps its lane down to the commit it branched from
    // rather than slanting into the mainline in the middle of a row.
    expect(edgesOf(rowOf(layout.rows, 'side1'))).toEqual([
      { fromLane: 1, toLane: 1, from: 0, to: 0.5, color: 1 },
      { fromLane: 0, toLane: 0, from: 0, to: 1, color: 0 },
      { fromLane: 1, toLane: 1, from: 0.5, to: 1, color: 1 },
    ])
    // Both lanes meet at the shared parent's dot: the side branch slants into
    // it from above instead of ending at the line between two rows.
    expect(edgesOf(rowOf(layout.rows, 'main0'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 1, toLane: 0, from: 0, to: 0.5, color: 1 },
    ])
    expect(rowOf(layout.rows, 'main0').node).toEqual({ lane: 0, color: 0 })
  })

  it('meets every lane that waited for a parent at its dot', () => {
    const layout = layoutGraph([
      { hash: 'm', parents: ['a', 'b'] },
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: [] },
    ])
    // 'a' keeps lane 0 and waits for 'b' there; 'm' already waits for 'b' on
    // lane 1. Both lines reach 'b' itself: the direct side line runs down lane
    // 1 and joins the dot, and 'a' continues in its lane.
    expect(edgesOf(rowOf(layout.rows, 'a'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 1, toLane: 1, from: 0, to: 1, color: 1 },
      { fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 },
    ])
    expect(edgesOf(rowOf(layout.rows, 'b'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 1, toLane: 0, from: 0, to: 0.5, color: 1 },
    ])
    expect(rowOf(layout.rows, 'b').node).toEqual({ lane: 0, color: 0 })
    expect(layout.lanes).toBe(2)
  })

  it('keeps the mainline hue where a side branch reached its base first', () => {
    const layout = layoutGraph([
      { hash: 'm', parents: ['main1', 'side2'] },
      { hash: 'side2', parents: ['base'] },
      { hash: 'main1', parents: ['base'] },
      { hash: 'base', parents: ['older'] },
      { hash: 'older', parents: [] },
    ])
    // The side branch reaches `base` before the mainline's own commit does, so
    // its line waits in the side hue; the mainline continues in the leftmost
    // lane and its hue wins at the dot.
    expect(rowOf(layout.rows, 'side2').node).toEqual({ lane: 1, color: 1 })
    expect(rowOf(layout.rows, 'main1').node).toEqual({ lane: 0, color: 0 })
    expect(edgesOf(rowOf(layout.rows, 'base'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 1, toLane: 0, from: 0, to: 0.5, color: 1 },
      { fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 },
    ])
    expect(rowOf(layout.rows, 'base').node).toEqual({ lane: 0, color: 0 })
    expect(rowOf(layout.rows, 'older').node.color).toBe(0)
  })

  it('keeps each child lane waiting for the shared parent and joins both at its dot', () => {
    const layout = layoutGraph([
      { hash: 'z', parents: ['a', 'p1', 'p2'] },
      { hash: 'a', parents: ['p1', 'p2'] },
      { hash: 'p1', parents: [] },
      { hash: 'p2', parents: [] },
    ])
    // 'a' opens lanes for both parents instead of reusing the lanes 'z' opened:
    // every edge keeps the hue of the commit that draws it until the dot, and
    // the second parent takes the first free column because both lanes the
    // other rows opened are still occupied.
    const merge = rowOf(layout.rows, 'a')
    expect(merge.edges.filter(edge => edge.from === 0.5).map(edge => ({ lane: edge.toLane, color: edge.color })))
      .toEqual([{ lane: 0, color: 0 }, { lane: 3, color: 3 }])
    // The lines that do not reach a dot keep their columns: only the segments
    // that end at a dot are slanted.
    expect(layout.lanes).toBe(4)
    // Both lanes waiting for 'p1' meet at its dot, and the leftmost one carries
    // the dot.
    expect(edgesOf(rowOf(layout.rows, 'p1'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 0.5, color: 0 },
      { fromLane: 1, toLane: 0, from: 0, to: 0.5, color: 1 },
      { fromLane: 2, toLane: 2, from: 0, to: 1, color: 2 },
      { fromLane: 3, toLane: 3, from: 0, to: 1, color: 3 },
    ])
    expect(rowOf(layout.rows, 'p1').node).toEqual({ lane: 0, color: 0 })
    expect(rowOf(layout.rows, 'p2').node).toEqual({ lane: 2, color: 2 })
  })

  it('draws vertical lines everywhere except into or out of a dot', () => {
    const layout = layoutGraph(FORK_MERGE)
    for (const row of layout.rows.values()) {
      for (const edge of row.edges) {
        if (edge.fromLane === edge.toLane) continue
        // A slanted segment is a branch corner: it begins or ends at a dot.
        expect(edge.from === 0.5 || edge.to === 0.5).toBe(true)
      }
    }
  })

  it('gives every open lane a different hue and keeps it along the branch', () => {
    const layout = layoutGraph([
      { hash: 'm', parents: ['a', 'b', 'c'] },
      { hash: 'a', parents: [] },
      { hash: 'b', parents: [] },
      { hash: 'c', parents: [] },
    ])
    const colors = lanesOf(rowOf(layout.rows, 'm'))
    expect(new Set(colors).size).toBe(3)
    expect(rowOf(layout.rows, 'm').node.color).toBe(0)
    expect(rowOf(layout.rows, 'a').node.color).toBe(0)
    expect(rowOf(layout.rows, 'b').node.color).toBe(1)
    expect(rowOf(layout.rows, 'c').node.color).toBe(2)
  })

  it('rotates the hue of successive branches', () => {
    const layout = layoutGraph([
      { hash: 'm1', parents: ['a1', 's1'] },
      { hash: 'a1', parents: ['m2'] },
      { hash: 's1', parents: ['m2'] },
      { hash: 'm2', parents: ['a2', 's2'] },
      { hash: 'a2', parents: [] },
      { hash: 's2', parents: [] },
    ])
    // The first side branch takes hue 1; the next one starts after it rather
    // than repeating the hue the previous branch used.
    expect(rowOf(layout.rows, 's1').node.color).toBe(1)
    expect(rowOf(layout.rows, 'm2').edges.filter(edge => edge.from === 0.5).map(edge => edge.color)).toEqual([0, 2])
    expect(rowOf(layout.rows, 's2').node.color).toBe(2)
  })

  it('gives an unrelated second tip its own lane while a branch stays open', () => {
    const layout = layoutGraph([
      { hash: 'a', parents: ['c'] },
      { hash: 'b', parents: ['d'] },
      { hash: 'c', parents: [] },
      { hash: 'd', parents: [] },
    ])
    // One ref's walk has a single tip; the layout still handles a second tip
    // arriving while lane 0 waits, giving it the next free hue.
    expect(layout.lanes).toBe(2)
    expect(rowOf(layout.rows, 'a').node).toEqual({ lane: 0, color: 0 })
    expect(rowOf(layout.rows, 'b').node).toEqual({ lane: 1, color: 1 })
    expect(edgesOf(rowOf(layout.rows, 'b'))).toEqual([
      { fromLane: 0, toLane: 0, from: 0, to: 1, color: 0 },
      { fromLane: 1, toLane: 1, from: 0.5, to: 1, color: 1 },
    ])
  })

  it('ends a line at a commit whose parent is outside the loaded page', () => {
    const page = layoutGraph([{ hash: 'x', parents: ['y'] }])
    const tip = rowOf(page.rows, 'x')
    expect(tip.node).toEqual({ lane: 0, color: 0 })
    expect(edgesOf(tip)).toEqual([])
    // Loading the next page extends the same row's line instead of restarting
    // the graph: the boundary row keeps its dot and gains its outgoing edge.
    const whole = layoutGraph([{ hash: 'x', parents: ['y'] }, { hash: 'y', parents: [] }])
    const continued = rowOf(whole.rows, 'x')
    expect(continued.node).toEqual(tip.node)
    expect(edgesOf(continued)).toEqual([{ fromLane: 0, toLane: 0, from: 0.5, to: 1, color: 0 }])
  })

  it('draws a single-commit page as one dot and an empty page as no rows', () => {
    const single = layoutGraph([{ hash: 'only', parents: [] }])
    expect(single.lanes).toBe(1)
    expect(single.rows.get('only')).toEqual({ node: { lane: 0, color: 0 }, edges: [] })
    expect(layoutGraph([])).toEqual({ lanes: 0, rows: new Map() })
  })

  it('clamps a wide fork into the gutter and cycles the palette once it runs out', () => {
    const parents = Array.from({ length: 8 }, (_, index) => `p${index}`)
    const commits: readonly GraphCommit[] = [
      { hash: 'm', parents },
      ...parents.map(hash => ({ hash, parents: [] })),
    ]
    const layout = layoutGraph(commits)
    // Eight open lanes exceed the six the gutter draws; every lane is clamped
    // into the drawn columns and the palette's hues repeat past six lanes.
    expect(layout.lanes).toBe(MAX_GRAPH_LANES)
    const merge = rowOf(layout.rows, 'm')
    expect(merge.node.lane).toBe(0)
    expect(merge.edges.every(edge => edge.toLane < MAX_GRAPH_LANES)).toBe(true)
    expect(merge.edges.map(edge => edge.toLane)).toEqual([0, 1, 2, 3, 4, 5, 5, 5])
    expect(merge.edges.map(edge => edge.color)).toEqual([0, 1, 2, 3, 4, 5, 0, 0])
  })

  it('keeps a commit whose lane moved past the cap inside the drawn columns', () => {
    const parents = Array.from({ length: 8 }, (_, index) => `p${index}`)
    const kept = Array.from({ length: 7 }, (_, index) => `p${index}`)
    const layout = layoutGraph([
      { hash: 'm', parents },
      // The first seven parents continue their own branch, so the eighth
      // parent's row is still the eighth open lane when it is drawn.
      ...kept.map((hash, index) => ({ hash, parents: [`q${index}`] })),
      { hash: 'p7', parents: [] },
      ...kept.map((_, index) => ({ hash: `q${index}`, parents: [] })),
    ])
    const last = rowOf(layout.rows, 'p7')
    expect(last.node.lane).toBe(MAX_GRAPH_LANES - 1)
    expect(last.edges.every(edge => edge.fromLane < MAX_GRAPH_LANES)).toBe(true)
    expect(last.edges.every(edge => edge.toLane < MAX_GRAPH_LANES)).toBe(true)
  })
})
