/** Conversation retraction projection: hide every row a `conversation-rewind` marker retracted. */

import type { ChatConversationViewNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'
import { coordinate, locationCoordinates } from './common.ts'

/** Durable `developer/message` source kind that marks one conversation retraction. */
export const CONVERSATION_REWIND_SOURCE_KIND = 'conversation-rewind'

/** Turn-level shell rows that only keep their place while the Turn keeps content. */
const TURN_SHELL_KINDS: ReadonlySet<string> = new Set(['turn-tail', 'turn-process', 'turn-error', 'turn-max-tokens'])

const NO_RANGES: readonly ChatSurfaceRange[] = []
const NO_CHANGED: ReadonlySet<string> = new Set()

/** Inclusive Chat anchor interval one retraction removed. */
interface ChatSurfaceRange {
  readonly startSeq: number
  readonly endSeq: number
}

/**
 * Read the durable source kind of a projected message source.
 * @param source - logged message source, possibly opaque.
 * @returns the source's string `kind`, or null.
 */
export function messageSourceKind(source: unknown): string | null {
  if (typeof source !== 'object' || source === null) return null
  const kind = (source as { kind?: unknown }).kind
  return typeof kind === 'string' ? kind : null
}

/**
 * Test whether a projected message source marks a conversation retraction.
 * @param source - logged message source.
 * @returns whether the source is the retraction marker.
 */
export function isConversationRewindSource(source: unknown): boolean {
  return messageSourceKind(source) === CONVERSATION_REWIND_SOURCE_KIND
}

/**
 * Read the retraction target from a projected message source. The marker's
 * `targetSeq` names the message the reader retracted; the Client reads it
 * structurally because the `conversation-rewind` source member is Host-owned.
 * @param source - logged message source.
 * @returns the valid target sequence, or undefined for every other source.
 */
export function retractionTarget(source: unknown): number | undefined {
  if (!isConversationRewindSource(source)) return undefined
  return coordinate((source as { targetSeq?: unknown }).targetSeq)
}

/** Merge overlapping or adjacent intervals into one ascending list. */
function mergeRanges(ranges: Iterable<ChatSurfaceRange>): readonly ChatSurfaceRange[] {
  const sorted = [...ranges].sort((left, right) => left.startSeq - right.startSeq)
  const merged: ChatSurfaceRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous !== undefined && range.startSeq <= previous.endSeq + 1) {
      if (range.endSeq > previous.endSeq) {
        merged[merged.length - 1] = { startSeq: previous.startSeq, endSeq: range.endSeq }
      }
      continue
    }
    merged.push(range)
  }
  return merged.length === 0 ? NO_RANGES : merged
}

/** Whether one anchor falls inside the merged intervals. */
function isRetractedAnchor(anchorSeq: number, ranges: readonly ChatSurfaceRange[]): boolean {
  for (const range of ranges) {
    if (anchorSeq < range.startSeq) return false
    if (anchorSeq <= range.endSeq) return true
  }
  return false
}

/**
 * Hide one Node without disturbing a Node its Definition already hid. The
 * group-tree position goes with the row: a retracted Turn must not keep the
 * latest exchange, and a hidden Node is never grouped.
 */
function hideNode(node: ChatConversationViewNode): ChatConversationViewNode {
  return node.visibility === 'hidden' && node.surfaceHidden === true
    ? node
    : { ...node, visibility: 'hidden', surfaceHidden: true, groupTree: undefined }
}

interface RetractionProjection {
  readonly nodes: readonly ChatConversationViewNode[]
  /** Keys whose Node the projection replaced. */
  readonly changed: ReadonlySet<string>
}

/**
 * Hide every anchor inside the merged intervals, then the shell rows of a Turn
 * whose every content row an interval removed. An interval ends at its marker's
 * own sequence, so most retracted Turns' footers and notices fall inside it;
 * a Turn with no process evidence anchors its control before the target, and
 * that shell must leave with the rest of the Turn.
 */
function project(
  nodes: readonly ChatConversationViewNode[],
  ranges: readonly ChatSurfaceRange[],
): RetractionProjection {
  if (ranges.length === 0) return { nodes, changed: NO_CHANGED }
  const retractedKeys = new Set<string>()
  const retractedTurns = new Set<number>()
  const contentTurns = new Set<number>()
  for (const node of nodes) {
    const turn = locationCoordinates(node.location).turn
    if (isRetractedAnchor(node.anchorSeq, ranges)) {
      retractedKeys.add(node.key)
      if (turn !== undefined) retractedTurns.add(turn)
      continue
    }
    if (node.visibility === 'visible' && turn !== undefined && !TURN_SHELL_KINDS.has(node.kind)) contentTurns.add(turn)
  }
  if (retractedKeys.size === 0) return { nodes, changed: NO_CHANGED }
  const emptiedTurns = new Set([...retractedTurns].filter(turn => !contentTurns.has(turn)))
  const changed = new Set<string>()
  const projected = nodes.map((node) => {
    const turn = locationCoordinates(node.location).turn
    const hide = retractedKeys.has(node.key) || (turn !== undefined && emptiedTurns.has(turn))
    if (!hide) return node
    const next = hideNode(node)
    if (next === node) return node
    changed.add(node.key)
    return next
  })
  return changed.size === 0 ? { nodes, changed: NO_CHANGED } : { nodes: projected, changed }
}

/**
 * Applies conversation retractions to the Chat Node set. Intervals come from the
 * materialized marker Nodes, so replay, paging, and live appends agree, and a
 * later retraction can hide an earlier marker's still-hidden interval. A Node
 * already hidden by its Definition is never made visible.
 */
export class SurfaceRewriteProjector {
  /** Retracted interval by the marker Node that recorded it. */
  private readonly rewrites = new Map<string, ChatSurfaceRange>()
  private ranges: readonly ChatSurfaceRange[] = NO_RANGES

  /**
   * Rebuild from one complete Node set.
   * @param nodes - every materialized Chat Node, before retraction filtering.
   * @returns the same Nodes with every retracted interval hidden.
   */
  replace(nodes: readonly ChatConversationViewNode[]): readonly ChatConversationViewNode[] {
    this.rewrites.clear()
    for (const node of nodes) {
      if (node.retraction === undefined) continue
      this.rewrites.set(node.key, { startSeq: node.retraction.targetSeq, endSeq: node.anchorSeq })
    }
    this.ranges = mergeRanges(this.rewrites.values())
    return project(nodes, this.ranges).nodes
  }

  /**
   * Fold one incremental upsert set.
   * @param upserts - Nodes the engine rebuilt.
   * @param store - resident projected Nodes; a new interval re-projects all of them.
   * @returns the upserts plus resident Nodes whose visibility changed.
   */
  apply(
    upserts: readonly ChatConversationViewNode[],
    store: ChatNodeStore,
  ): readonly ChatConversationViewNode[] {
    const incoming = new Map(upserts.map(node => [node.key, node]))
    let rangesChanged = false
    for (const node of upserts) {
      // A retraction marker is a start-only Context: a new interval arrives once
      // per key, and only a window replacement removes one.
      if (node.retraction === undefined) continue
      this.rewrites.set(node.key, { startSeq: node.retraction.targetSeq, endSeq: node.anchorSeq })
      rangesChanged = true
    }
    if (rangesChanged) this.ranges = mergeRanges(this.rewrites.values())
    const candidates = rangesChanged
      ? [...store.values().filter(node => !incoming.has(node.key)), ...upserts]
      : upserts
    const projection = project(candidates, this.ranges)
    if (!rangesChanged && projection.changed.size === 0) return upserts
    const projectedByKey = new Map(projection.nodes.map(node => [node.key, node]))
    const result: ChatConversationViewNode[] = upserts.map(node => projectedByKey.get(node.key) ?? node)
    for (const key of projection.changed) {
      if (incoming.has(key)) continue
      const node = projectedByKey.get(key)
      if (node !== undefined) result.push(node)
    }
    return result
  }
}
