import type { MergedConnectionTopology } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getMstEdgeTraceWidths } from "./getMstEdgeTraceWidths"

export function collectPipeline9PowerTraceWidthTargets(
  { connection, sources, edges, emittedNames }: MergedConnectionTopology,
  defaultTraceWidth: number,
  targets: Map<string, number>,
): void {
  if (emittedNames.size === 0) return

  const sourceWidths = new Set(
    sources.map(
      (source) =>
        source.nominalTraceWidth ?? source.width ?? defaultTraceWidth,
    ),
  )
  if (sourceWidths.size < 2) return

  const edgeWidths = getMstEdgeTraceWidths(
    connection.pointsToConnect,
    edges,
    sources,
    defaultTraceWidth,
  )
  for (const [edge, name] of emittedNames) {
    const width = edgeWidths.get(edge)
    if (width === undefined) {
      throw new Error(`Missing source width target for "${name}"`)
    }
    targets.set(name, width)
  }
}
