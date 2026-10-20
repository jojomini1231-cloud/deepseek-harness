/**
 * The history list's inline commit graph: a pure lane layout over the loaded
 * commits, newest first.
 *
 * The list rows carry the graph in a narrow gutter rather than a graph column.
 * A row's drawing is derived from the lanes that were open above it and the
 * lanes its own parents leave behind, so the same commits always draw the same
 * way: laying out a page and then its next page draws exactly the prefix the
 * one-pass layout of both would draw, which is what makes "load more" append a
 * continuous graph.
 *
 * Parallel lanes beyond {@link MAX_GRAPH_LANES} stay tracked so a later merge
 * still lands on the right lane, but they are not drawn and the commit dot is
 * clamped into the visible gutter.
 */

/** One commit as the graph reads it: its identity and its parent hashes. */
export interface GraphCommit {
  /** Full commit hash; the lane identity. */
  readonly hash: string
  /** Parent hashes in git's order; empty for the root commit. */
  readonly parents: readonly string[]
}

/** How many lanes the gutter draws before it stops widening. */
export const MAX_GRAPH_LANES = 6

/** Vertical line segment in one lane, `from`..`to` across the row. */
export interface GraphSegment {
  /** Lane index, left to right from zero. */
  readonly lane: number
  /** Row fraction where the segment starts: 0 is the row top, 0.5 the dot. */
  readonly from: number
  /** Row fraction where the segment ends: 0.5 the dot, 1 the row bottom. */
  readonly to: number
  /** Color index the lane was first assigned. */
  readonly color: number
}

/** Curve from the commit dot to a parent that continues on another lane. */
export interface GraphCurve {
  /** Lane the curve leaves, at the dot. */
  readonly from: number
  /** Lane the curve reaches, at the row bottom. */
  readonly to: number
  /** Color index of the parent lane. */
  readonly color: number
}

/** One row's drawing: its lane count, dot, and lines. */
export interface GraphRow {
  /** Visible lanes the gutter reserves width for, at least one. */
  readonly lanes: number
  /** The commit's dot: its lane and color index. */
  readonly dot: { readonly lane: number; readonly color: number }
  /** Vertical lines above and below the dot. */
  readonly segments: readonly GraphSegment[]
  /** Curves leaving the dot for parents on other lanes. */
  readonly curves: readonly GraphCurve[]
}

/** One lane's open end: the commit its line waits for. */
interface OpenLane {
  readonly hash: string
  readonly color: number
}

/**
 * Lay out the inline graph for a page of commits.
 * @param commits - the loaded commits, newest first and in git's order.
 * @returns one row drawing per commit hash.
 */
export function layoutGraph(commits: readonly GraphCommit[]): ReadonlyMap<string, GraphRow> {
  const maxLanes = MAX_GRAPH_LANES
  /** Open lanes: the commit each lane's line descends toward, or empty. */
  let lanes: Array<OpenLane | undefined> = []
  /** Next color index; lanes keep their first color for their whole life. */
  let colorSeq = 0
  const known = new Set(commits.map(commit => commit.hash))
  const rows = new Map<string, GraphRow>()
  for (const commit of commits) {
    // The commit owns the lane that was waiting for it, or opens a new one.
    let at = lanes.findIndex(lane => lane?.hash === commit.hash)
    if (at < 0) {
      at = lanes.findIndex(lane => lane === undefined)
      if (at < 0) at = lanes.length
    }
    const color = lanes[at]?.color ?? colorSeq++
    const before = lanes.slice()
    const after = lanes.slice()
    after[at] = undefined
    const parents = commit.parents.flatMap((parent, index) => known.has(parent)
      ? [{ parent, first: index === 0 }]
      : [])
    const targets: number[] = []
    for (const { parent, first } of parents) {
      let target = after.findIndex(lane => lane?.hash === parent)
      if (target < 0) {
        // The first parent continues the commit's own line; later parents open
        // (or reuse) a lane to the right and take a fresh color.
        if (first) {
          target = at
        } else {
          target = after.findIndex(lane => lane === undefined)
          if (target < 0) target = after.length
        }
        after[target] = { hash: parent, color: target === at ? color : colorSeq++ }
      }
      targets.push(target)
    }
    const drawnLanes = Math.max(1, Math.min(maxLanes,
      Math.max(before.length, after.length, at + 1, ...targets.map(target => target + 1))))
    const segments: GraphSegment[] = []
    for (let lane = 0; lane < drawnLanes; lane += 1) {
      const above = before[lane]
      const below = after[lane]
      if (lane === at) {
        if (above !== undefined) segments.push({ lane, from: 0, to: 0.5, color: above.color })
        if (targets.includes(at) && below !== undefined) {
          segments.push({ lane, from: 0.5, to: 1, color: below.color })
        }
      } else if (above !== undefined && below !== undefined) {
        segments.push({ lane, from: 0, to: 1, color: above.color })
      } else if (below !== undefined) {
        segments.push({ lane, from: 0.5, to: 1, color: below.color })
      }
    }
    const curves: GraphCurve[] = []
    // Past the drawn cap the dot is clamped into the gutter, so a curve leaves
    // from the lane the dot occupies rather than from the lane the branch
    // really sits on: a curve that started off the drawn lanes would read as a
    // line that lost its commit.
    const dotLane = Math.min(at, drawnLanes - 1)
    for (const target of targets) {
      if (target === at || target === dotLane || target >= drawnLanes) continue
      /* v8 ignore next -- a drawn parent lane was just assigned its color. */
      curves.push({ from: dotLane, to: target, color: after[target]?.color ?? color })
    }
    rows.set(commit.hash, {
      lanes: drawnLanes,
      dot: { lane: Math.min(at, drawnLanes - 1), color },
      segments,
      curves,
    })
    // Trailing empty lanes no longer take width; the rest stay where they are.
    while (after.length > 0 && after[after.length - 1] === undefined) after.pop()
    lanes = after
  }
  return rows
}
