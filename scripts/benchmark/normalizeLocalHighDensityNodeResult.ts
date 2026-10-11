import type {
  Pipeline9NetworkedHighDensityNodeInput,
  Pipeline9NetworkedHighDensityNodeOutput,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import type {
  HighDensityIntraNodeRoute,
  PortPoint,
} from "../../lib/types/high-density-types"

/** Preserve exact terminal identities after a solver's grow/shrink arithmetic. */
export function normalizeLocalHighDensityNodeResult(
  input: Pipeline9NetworkedHighDensityNodeInput,
  output: Pipeline9NetworkedHighDensityNodeOutput,
): Pipeline9NetworkedHighDensityNodeOutput {
  if (output.status !== "solved" || output.solutionStage !== "ordinary")
    return output
  const node = input.nodeWithPortPoints
  const routes = output.routes.map((route): HighDensityIntraNodeRoute => {
    const points = route.route.map(
      (point, index): HighDensityIntraNodeRoute["route"][number] => {
        if (index !== 0 && index !== route.route.length - 1) return point
        let terminal: PortPoint | undefined
        let nearestDistance = Number.POSITIVE_INFINITY
        for (const portPoint of node.portPoints) {
          if (
            portPoint.connectionName !== route.connectionName ||
            portPoint.z !== point.z
          ) {
            continue
          }
          const tolerance =
            32 *
            Number.EPSILON *
            Math.max(
              1,
              Math.abs(node.center.x),
              Math.abs(node.center.y),
              Math.abs(point.x),
              Math.abs(point.y),
              Math.abs(portPoint.x),
              Math.abs(portPoint.y),
            )
          const distance = Math.hypot(
            point.x - portPoint.x,
            point.y - portPoint.y,
          )
          if (
            Math.abs(point.x - portPoint.x) <= tolerance &&
            Math.abs(point.y - portPoint.y) <= tolerance &&
            distance < nearestDistance
          ) {
            terminal = portPoint
            nearestDistance = distance
          }
        }
        // A decimal rounding boundary can split equal terminal keys after a
        // ~1e-16 mm transform. Restore only machine roundoff, never a gap.
        return terminal ? { ...point, x: terminal.x, y: terminal.y } : point
      },
    )
    return { ...route, route: points }
  })
  return { ...output, routes }
}
