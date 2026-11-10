import type {
  DifferentialPair,
  SimpleRouteConnection,
  Obstacle,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"
import { getConnectionPointLayers } from "./connection-point-utils"
import { mapZToLayerName } from "./mapZToLayerName"
import { assertOwnedRouteTopology } from "./assertOwnedRouteTopology"

type PairGeometryInput = {
  differentialPairs: DifferentialPair[]
  connections: SimpleRouteConnection[]
  obstacles: Obstacle[]
  layerCount: number
}

/** Check exact coverage and measure planar copper, never bridging component gaps. */
export const assertDifferentialPairRoutes = (
  input: PairGeometryInput,
  routes: HighDensityRoute[],
  checkSkew: boolean,
): void => {
  for (const [pairIndex, pair] of input.differentialPairs.entries()) {
    const lengths = pair.connectionNames.map((names): number =>
      names.reduce((total, name): number => {
        const connections = input.connections.filter(
          (connection): boolean => connection.name === name,
        )
        const matchingRoutes = routes.filter(
          (route): boolean => route.connectionName === name,
        )
        if (connections.length !== 1 || matchingRoutes.length !== 1)
          throw new DifferentialPairRoutingError(
            {
              reason:
                matchingRoutes.length === 0
                  ? "missing_hop_route"
                  : "ownership_violation",
              pairIndex,
              connectionName: name,
            },
            `pair ${pairIndex}: hop "${name}" requires one original connection and one complete stitched route, got ${connections.length} / ${matchingRoutes.length}`,
          )
        const connection = connections[0]!
        const route = matchingRoutes[0]!
        const fail = (message: string): never => {
          throw new DifferentialPairRoutingError(
            { reason: "ownership_violation", pairIndex, connectionName: name },
            `pair ${pairIndex}: hop "${name}" ${message}`,
          )
        }
        if (
          connection.pointsToConnect.length !== 2 ||
          route.route.length < 2 ||
          route.jumpers?.length
        )
          fail("has incomplete or unsupported copper")
        const matches = (
          point: HighDensityRoute["route"][number],
          terminal: SimpleRouteConnection["pointsToConnect"][number],
        ): boolean =>
          Math.hypot(point.x - terminal.x, point.y - terminal.y) <= 1e-8 &&
          getConnectionPointLayers(terminal).includes(
            mapZToLayerName(point.z, input.layerCount),
          )
        const first = route.route[0]!
        const last = route.route.at(-1)!
        const [start, end] = connection.pointsToConnect
        if (
          !(
            (matches(first, start!) && matches(last, end!)) ||
            (matches(first, end!) && matches(last, start!))
          )
        )
          fail("does not preserve its declared endpoints/layers")
        let length = 0
        for (const [index, point] of route.route.entries()) {
          if (
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            !Number.isInteger(point.z) ||
            point.z < 0 ||
            point.z >= input.layerCount ||
            point.toNextSegmentType ||
            point.insideJumperPad
          )
            fail("contains invalid or unsupported geometry")
          if (index === 0) continue
          const previous = route.route[index - 1]!
          const distance = Math.hypot(
            point.x - previous.x,
            point.y - previous.y,
          )
          if (
            previous.z !== point.z &&
            (distance > 1e-8 ||
              !route.vias.some(
                (via): boolean =>
                  Math.hypot(via.x - point.x, via.y - point.y) <= 1e-8,
              ))
          )
            fail("has a discontinuous layer transition")
          length += distance
        }
        return total + length
      }, 0),
    )
    // Numerical allowance only; not an additional routing tolerance.
    if (
      checkSkew &&
      Math.abs(lengths[0]! - lengths[1]!) > pair.maxLengthSkewMm + 1e-9
    )
      throw new DifferentialPairRoutingError(
        {
          reason: "length_skew",
          pairIndex,
          laneLengthsMm: [lengths[0]!, lengths[1]!],
        },
        `pair ${pairIndex}: P ${lengths[0]!.toFixed(6)}mm, N ${lengths[1]!.toFixed(6)}mm exceeds maxLengthSkewMm ${pair.maxLengthSkewMm}`,
      )
  }
  assertOwnedRouteTopology(input, routes)
}
