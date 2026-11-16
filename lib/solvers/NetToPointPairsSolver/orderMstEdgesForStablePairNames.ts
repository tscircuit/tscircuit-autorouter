import type { ConnectionPoint } from "lib/types"
import type { Edge } from "./buildMinimumSpanningTree"

type PointPairKey = `${number}:${number}`

function getPointPairKey(
  edge: Edge<ConnectionPoint>,
  pointIndexes: ReadonlyMap<ConnectionPoint, number>,
): PointPairKey {
  const from = pointIndexes.get(edge.from)
  const to = pointIndexes.get(edge.to)
  if (from === undefined || to === undefined) {
    throw new Error("MST edge references a point outside its connection")
  }
  return `${Math.min(from, to)}:${Math.max(from, to)}`
}

/** Retained pairs keep their emitted names and direction; new edges fill removed slots. */
export function orderMstEdgesForStablePairNames({
  points,
  originalEdges,
  optimizedEdges,
}: {
  points: ConnectionPoint[]
  originalEdges: Edge<ConnectionPoint>[]
  optimizedEdges: Edge<ConnectionPoint>[]
}): Edge<ConnectionPoint>[] {
  if (originalEdges.length !== optimizedEdges.length) {
    throw new Error("Layer-aware and XY trees have different edge counts")
  }
  const pointIndexes = new Map<ConnectionPoint, number>(
    points.map((point, index): [ConnectionPoint, number] => [point, index]),
  )
  const originalKeys = new Set(
    originalEdges.map((edge) => getPointPairKey(edge, pointIndexes)),
  )
  const optimizedKeys = new Set(
    optimizedEdges.map((edge) => getPointPairKey(edge, pointIndexes)),
  )
  const replacements = optimizedEdges.filter(
    (edge) => !originalKeys.has(getPointPairKey(edge, pointIndexes)),
  )
  let replacementIndex = 0
  return originalEdges.map((edge): Edge<ConnectionPoint> => {
    if (optimizedKeys.has(getPointPairKey(edge, pointIndexes))) return edge
    const replacement = replacements[replacementIndex++]
    if (!replacement) {
      throw new Error("Missing replacement for a removed point-pair edge")
    }
    return replacement
  })
}
