import { createIntraNodeSegmentValidator } from "lib/solvers/HyperHighDensitySolver/createIntraNodeSegmentValidator"
import type { PortPoint } from "lib/types/high-density-types"
import {
  createPreloadedCopperLookup,
  type PreloadedCopperInput,
} from "./createPreloadedCopperLookup"
import { arePipeline9RoutesOnSameNet } from "./pipeline9FixedRouteCopper"

type PortValidator = (
  point: PortPoint,
  options?: { includeClearance?: boolean },
) => boolean

/** Validate crossings against preloaded wire and via copper. */
export function createPreloadedPortValidator(
  input: PreloadedCopperInput,
): PortValidator {
  const { getBlockers } = createPreloadedCopperLookup(input)
  const isBoardPointClear = createIntraNodeSegmentValidator({
    fixedHdRoutes: [], obstacles: input.srj.obstacles, connMap: input.connMap,
    layerCount: input.srj.layerCount,
    clearance: input.srj.minTraceToPadEdgeClearance ?? input.srj.defaultObstacleMargin ?? 0.1,
    allowBlindAndBuriedVias: input.srj.allowBlindAndBuriedVias,
    allowViaInPad: input.srj.allowViaInPad,
  })
  return (point, options): boolean =>
    isBoardPointClear({ start: point, end: point,
      connectionName: point.connectionName, rootConnectionName: point.rootConnectionName,
      traceThickness: input.traceWidth, viaDiameter: input.viaDiameter }) &&
    getBlockers(point, options).every((route) =>
      arePipeline9RoutesOnSameNet({ left: point, right: route }, input.connMap),
    )
}
