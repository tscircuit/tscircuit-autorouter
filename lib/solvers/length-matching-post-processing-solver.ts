// TODO: replace the pinned matcher with a release containing length-matching-solver#89.
import {
  LengthMatchingSolver,
  type LengthMatchingPair,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  DifferentialPair,
  Obstacle,
  SimplifiedPcbTraces,
  SimpleRouteBus,
  SimpleRouteConnection,
} from "lib/types/srj-types"
import { assertDifferentialPairRoutes } from "lib/utils/assertDifferentialPairRoutes"
import { DifferentialPairRoutingError } from "lib/utils/DifferentialPairRoutingError"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { BaseSolver } from "./BaseSolver"

type LengthMatchingPostProcessingSolverParams = {
  hdRoutes: HighDensityRoute[]
  differentialPairs: DifferentialPair[]
  buses: SimpleRouteBus[]
  connections: SimpleRouteConnection[]
  traces?: SimplifiedPcbTraces
  obstacles: Obstacle[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  layerCount: number
  obstacleMargin: number
}

/** Adapt existing bus roots to exact route memberships without changing roots. */
const getBusLengthMatchingInput = (
  params: LengthMatchingPostProcessingSolverParams,
): { pairs: LengthMatchingPair[]; connections: SimpleRouteConnection[] } => {
  const ownedNames = new Set(
    params.differentialPairs.flatMap((pair) => pair.connectionNames.flat()),
  )
  const connections = new Map<string, SimpleRouteConnection>()
  const pairs: LengthMatchingPair[] = []
  for (const bus of params.buses) {
    if (bus.maxLengthSkew === undefined || bus.connectionNames.length < 2)
      continue
    const members = bus.connectionNames.map((name) => {
      const routes = params.hdRoutes.filter(
        (route): boolean =>
          (route.rootConnectionName ?? route.connectionName) === name,
      )
      if (routes.length === 0)
        throw new Error(
          `Length matching: bus "${bus.busId}" has no routed geometry for connection "${name}"`,
        )
      for (const route of routes) {
        if (ownedNames.has(route.connectionName))
          throw new DifferentialPairRoutingError(
            `hop "${route.connectionName}" also belongs to length-matched bus "${bus.busId}"`,
          )
        if (route.route.length < 2)
          throw new Error(
            `Length matching: bus route "${route.connectionName}" is incomplete`,
          )
        connections.set(route.connectionName, {
          name: route.connectionName,
          pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
            (point) => ({
              x: point.x,
              y: point.y,
              layer: mapZToLayerName(point.z, params.layerCount),
            }),
          ),
        })
      }
      return {
        names: routes.map((route): string => route.connectionName) as [
          string,
          ...string[],
        ],
        length: routes.reduce(
          (total, route): number =>
            total +
            route.route
              .slice(1)
              .reduce(
                (length, point, index): number =>
                  length +
                  Math.hypot(
                    point.x - route.route[index]!.x,
                    point.y - route.route[index]!.y,
                  ),
                0,
              ),
          0,
        ),
      }
    })
    const longest = members.reduce((a, b) => (a.length > b.length ? a : b))
    for (const member of members) {
      if (member === longest) continue
      pairs.push({
        connectionNames: [member.names, longest.names],
        maxLengthSkewMm: bus.maxLengthSkew,
      })
    }
  }
  return { pairs, connections: [...connections.values()] }
}

export class LengthMatchingPostProcessingSolver extends BaseSolver {
  private readonly matcher: LengthMatchingSolver

  constructor(
    private readonly params: LengthMatchingPostProcessingSolverParams,
  ) {
    super()
    const busInput = getBusLengthMatchingInput(params)
    const ownedNames = new Set(
      params.differentialPairs.flatMap((pair) => pair.connectionNames.flat()),
    )
    this.matcher = new LengthMatchingSolver({
      ...params,
      originalConnections: [
        ...params.connections.filter((connection): boolean =>
          ownedNames.has(connection.name),
        ),
        ...busInput.connections,
      ],
      differentialPairs: [...params.differentialPairs, ...busInput.pairs],
    })
    this.MAX_ITERATIONS = this.matcher.MAX_ITERATIONS + 2
  }

  override _step(): void {
    if (this.iterations === 1)
      assertDifferentialPairRoutes(this.params, this.params.hdRoutes, false)
    this.matcher.step()
    if (this.matcher.failed) {
      this.failed = true
      this.error = this.matcher.error
      return
    }
    if (!this.matcher.solved) return
    assertDifferentialPairRoutes(
      this.params,
      this.matcher.getOutput().matchedHdRoutes,
      true,
    )
    this.solved = true
  }

  getOutput(): { hdRoutes: HighDensityRoute[] } {
    if (!this.solved)
      throw new Error(
        "LengthMatchingPostProcessingSolver output requested before completion",
      )
    return { hdRoutes: this.matcher.getOutput().matchedHdRoutes }
  }

  override visualize(): GraphicsObject {
    return this.matcher.visualize()
  }
}
