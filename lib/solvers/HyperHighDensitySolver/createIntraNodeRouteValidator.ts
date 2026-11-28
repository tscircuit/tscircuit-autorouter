import type { HighDensityRoute } from "lib/types/high-density-types"
import { arePipeline9RoutesOnSameNet, doPipeline9RoutesHaveCopperConflict, getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { createIntraNodeSegmentValidator } from "./createIntraNodeSegmentValidator"

type CopperInput = Parameters<typeof createIntraNodeSegmentValidator>[0]

/** Check current board-world copper, including cleanup's moved endpoints. */
export function createIntraNodeRouteValidator(
  input: CopperInput,
): (routes: HighDensityRoute[]) => boolean {
  const validate = createIntraNodeSegmentValidator(input)
  let validateExistingCopper: ReturnType<typeof createIntraNodeSegmentValidator> | undefined
  return (routes): boolean => {
    for (const route of materializePipeline9HdRouteVias(routes)) {
      const geometry = getPipeline9RouteCopperGeometry(route, input)
      const connection = {
        connectionName: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        traceThickness: route.traceThickness,
        viaDiameter: route.viaDiameter,
      }
      for (const wire of geometry.wireSegments) {
        if (!validate({ ...connection, start: wire.start, end: wire.end,
          traceThickness: wire.width })) return false
      }
      for (const via of geometry.viaSpans) {
        const existingObstacle = route.route.some((point, index) => {
          const end = route.route[index + 1]
          return point.toNextSegmentType === "through_obstacle" && end !== undefined &&
            Math.hypot(point.x - via.center.x, point.y - via.center.y) <= 1e-9 &&
            Math.hypot(end.x - via.center.x, end.y - via.center.y) <= 1e-9 &&
            Math.min(point.z, end.z) <= via.minZ &&
            Math.max(point.z, end.z) >= via.maxZ
        })
        // Reusing a conductor skips drilling into its own pad, not copper clearance.
        if (existingObstacle) validateExistingCopper ??= createIntraNodeSegmentValidator({
          ...input, allowViaInPad: true,
        })
        const validateVia = existingObstacle ? validateExistingCopper! : validate
        if (!validateVia({ ...connection, start: { ...via.center, z: via.minZ },
          end: { ...via.center, z: via.maxZ }, viaDiameter: via.diameter })) return false
      }
    }
    // A candidate must clear its own other-net copper as well as the board.
    for (const [index, route] of routes.entries()) {
      for (const other of routes.slice(index + 1)) {
        if (!arePipeline9RoutesOnSameNet({ left: route, right: other }, input.connMap) &&
          doPipeline9RoutesHaveCopperConflict({ left: route, right: other,
            layerCount: input.layerCount, clearance: input.clearance,
            allowBlindAndBuriedVias: input.allowBlindAndBuriedVias })) return false
      }
    }
    return true
  }
}
