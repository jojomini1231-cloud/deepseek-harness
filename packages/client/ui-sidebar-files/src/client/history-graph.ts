/**
 * The history list's inline commit graph: a pure lane layout over the loaded
 * commits, newest first.
 *
 * The layout follows Sugiyama's three phases with the layers already fixed:
 * git's topological order puts one commit on each row, so the row is the layer
 * and only the lane order and coordinates remain. The ordering phase keeps lanes
 * in their order: every child keeps a lane waiting for its parent, so the lanes
 * waiting for one commit meet at that commit's dot — the leftmost of them
 * becomes the dot and continues the chain, and the others slant into it at the
 * row's corner. A commit's first loaded parent continues its lane and hue, and
 * every further parent joins the lane already waiting for it or else takes a
 * free lane beside the dot, so a fork leaves the dot at a corner. A lane keeps
 * its column until the commit it waits for arrives, so a line holds its place
 * and the layout draws straight vertical segments except at those corners; the
 * column a branch leaves is free for the next branch. The coordinate phase gives
 * every lane one x, so each row draws straight segments between the lane a line
 * occupied above the row and the lane it occupies below. Segments compose across
 * rows into the DAG's parent edges, including the diagonals at merges and forks.
 *
 * The boundary row is continuous across pages: a parent outside the loaded set
 * draws no lane, so "load more" extends that row instead of restarting the
 * graph. Rows already above the boundary can still move when a later page names
 * a parent they could not place, because the lane order depends only on the
 * commits loaded above them.
 *
 * A branch keeps its hue for the life of its lane, and a new branch takes the
 * next hue no open lane uses in a rotating sequence, so successive branches
 * differ even when they reuse a column and the hues tell the lanes apart. The
 * walked ref's first-parent chain always keeps the leftmost lane, so the
 * mainline reads in one hue through the commits its side branches merge back
 * into.
 */

/** One commit as the graph reads it: its identity and its parent hashes. */
export interface GraphCommit {
  /** Full commit hash; the row's identity. */
  readonly hash: string
  /** Parent hashes in git's order; empty for the root commit. */
  readonly parents: readonly string[]
}

/** How many lanes the gutter draws before it stops widening. */
export const MAX_GRAPH_LANES = 6

/** Lane colors the stylesheet defines (`lane0`..`lane5`). */
const LANE_COLORS = 6

/** One straight segment crossing a row, in lane units and row fractions. */
export interface GraphEdge {
  /** Lane index at the segment's start, from the row's leading edge. */
  readonly fromLane: number
  /** Lane index at the segment's end. */
  readonly toLane: number
  /** Row fraction the segment starts at: 0 is the row top, 0.5 the commit dot. */
  readonly from: number
  /** Row fraction the segment ends at: 0.5 is the commit dot, 1 the row bottom. */
  readonly to: number
  /** Lane color index, 0 through 5. */
  readonly color: number
}

/** One row's drawing. */
export interface GraphRow {
  /** The commit's dot: its lane and color index. */
  readonly node: { readonly lane: number; readonly color: number }
  /** The segments crossing the row; together they compose the parent edges. */
  readonly edges: readonly GraphEdge[]
}

/** The loaded history's drawing. */
export interface GraphLayout {
  /** Widest drawn row's lane count, clamped to {@link MAX_GRAPH_LANES}; 0 for an empty page. */
  readonly lanes: number
  /** One row per loaded commit hash. */
  readonly rows: ReadonlyMap<string, GraphRow>
}

/** One open lane: the commit its line waits for and the hue it carries. */
interface Lane {
  readonly hash: string
  readonly color: number
}

/** One lane waiting for the row's commit. */
interface Waiting {
  /** Lane index in the row's leading state. */
  readonly index: number
  /** The lane itself, for its hue. */
  readonly lane: Lane
}

/**
 * Find the first free column at or after one position.
 * @param lanes - the open lanes, with `undefined` for a free column.
 * @param from - the first column to consider.
 * @returns the first free column, or the array's end when every column is taken.
 */
function freeColumn(lanes: readonly (Lane | undefined)[], from: number): number {
  for (let column = from; column < lanes.length; column += 1) if (lanes[column] === undefined) return column
  return lanes.length
}

/**
 * Lay out the inline commit graph for a page of commits.
 * @param commits - the loaded commits, newest first and in git's topological order.
 * @returns the gutter's lane count and one row drawing per commit hash.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphLayout {
  const known = new Set(commits.map(commit => commit.hash))
  let lanes: readonly (Lane | undefined)[] = []
  const rows = new Map<string, GraphRow>()
  let widest = 0
  // The hue the next new branch starts looking from; advancing it makes
  // successive branches differ without repeating a hue that is still open.
  let nextHue = 0
  /**
   * Take the next hue no open lane uses, advancing the rotation.
   * @param taken - one bit per color index already in use.
   * @returns a free color index, or the rotation's current index when every hue is taken.
   */
  const freshColor = (taken: number): number => {
    for (let offset = 0; offset < LANE_COLORS; offset += 1) {
      const color = (nextHue + offset) % LANE_COLORS
      if ((taken & (1 << color)) !== 0) continue
      nextHue = (color + 1) % LANE_COLORS
      return color
    }
    return nextHue
  }
  for (const commit of commits) {
    const before = lanes
    // Every child keeps a lane waiting for the parent, so several lanes can
    // wait for one commit; its dot is where they meet.
    const waiting: Waiting[] = []
    // One bit per hue an open lane carries, so a new branch avoids them
    // without building a Set per row.
    let takenColors = 0
    for (const [index, lane] of before.entries()) {
      if (lane === undefined) continue
      takenColors |= 1 << lane.color
      if (lane.hash === commit.hash) waiting.push({ index, lane })
    }
    const first = waiting[0]
    const tip = first === undefined
    const nodeTop = first === undefined ? freeColumn(before, 0) : first.index
    // The dot's hue is the hue of the leftmost lane that waited for it; a tip
    // takes a fresh hue.
    const nodeColor = first === undefined ? freshColor(takenColors) : first.lane.color
    // The dot meets every lane that waited for it, and a line keeps its column
    // until then: only the corners of the row are diagonal.
    const after = [...before]
    for (const { index } of waiting) after[index] = undefined
    const edges: GraphEdge[] = []
    if (!tip) edges.push({ fromLane: nodeTop, toLane: nodeTop, from: 0, to: 0.5, color: nodeColor })
    for (const { index, lane } of waiting) {
      if (index === nodeTop) continue
      edges.push({ fromLane: index, toLane: nodeTop, from: 0, to: 0.5, color: lane.color })
    }
    let widestHere = nodeTop
    for (const [index, lane] of before.entries()) {
      if (lane === undefined || lane.hash === commit.hash) continue
      edges.push({ fromLane: index, toLane: index, from: 0, to: 1, color: lane.color })
    }
    // The first parent continues the dot's column and hue; each further parent
    // joins the lane already waiting for it, or else takes the nearest free
    // column beside the dot and leaves the dot at a corner.
    let takenBits = 0
    for (const lane of after) if (lane !== undefined) takenBits |= 1 << lane.color
    let continuation = true
    for (const parent of commit.parents) {
      if (!known.has(parent)) continue
      if (!continuation) {
        // Two children of one commit share the line already waiting for it
        // rather than growing a second lane that waits for the same hash.
        const waitingAt = after.findIndex(lane => lane?.hash === parent)
        const joined = waitingAt >= 0 ? after[waitingAt] : undefined
        if (joined !== undefined) {
          edges.push({ fromLane: nodeTop, toLane: waitingAt, from: 0.5, to: 1, color: joined.color })
          continue
        }
      }
      const color = continuation ? nodeColor : freshColor(takenBits)
      const column = continuation ? nodeTop : freeColumn(after, nodeTop + 1)
      after[column] = { hash: parent, color }
      takenBits |= 1 << color
      edges.push({ fromLane: nodeTop, toLane: column, from: 0.5, to: 1, color })
      continuation = false
    }
    // The drawn width covers every lane a segment touches, so a lane that only
    // enters on a corner still gets its own column.
    for (const edge of edges) {
      if (edge.fromLane > widestHere) widestHere = edge.fromLane
      if (edge.toLane > widestHere) widestHere = edge.toLane
    }
    const width = Math.min(MAX_GRAPH_LANES, 1 + widestHere)
    const drawnLane = (lane: number): number => lane < width ? lane : width - 1
    const clamped = edges.map(edge => ({
      ...edge, fromLane: drawnLane(edge.fromLane), toLane: drawnLane(edge.toLane),
    }))
    // Every lane past the drawn width clamps onto the last column, so their
    // segments land on one another. Only the segment that paints last at each
    // position survives, in its own paint order: the drawing is what it already
    // was, without the nodes the covered ones would have cost.
    const lastAt = new Map<string, number>()
    for (const [index, edge] of clamped.entries()) lastAt.set(`${edge.fromLane}:${edge.toLane}:${edge.from}:${edge.to}`, index)
    const drawn = clamped.filter((edge, index) => lastAt.get(`${edge.fromLane}:${edge.toLane}:${edge.from}:${edge.to}`) === index)
    rows.set(commit.hash, { node: { lane: drawnLane(nodeTop), color: nodeColor }, edges: drawn })
    widest = Math.max(widest, width)
    while (after.length > 0 && after[after.length - 1] === undefined) after.pop()
    lanes = after
  }
  return { lanes: widest, rows }
}
