// TODO: replace the pinned matcher with a release containing length-matching-solver#89.
import {
  LengthMatchingSolver,
  type LengthMatchingPair,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  ConnectionPoint,
  DifferentialPair,
  Obstacle,
  SimplifiedPcbTraces,
  SimpleRouteBus,
  SimpleRouteConnection,
} from "lib/types/srj-types"
import { getHighDensityRouteLength } from "lib/utils/getHighDensityRouteLength"
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

type BusMember = { names: [string, ...string[]]; length: number }

/** Adapt existing bus roots to exact route memberships without changing roots. */
const getBusLengthMatchingInput = (
  params: LengthMatchingPostProcessingSolverParams,
): { pairs: LengthMatchingPair[]; connections: SimpleRouteConnection[] } => {
  const ownedNames = new Set(
    params.differentialPairs.flatMap((pair): string[] =>
      pair.connectionNames.flat(),
    ),
  )
  const connections = new Map<string, SimpleRouteConnection>()
  const pairs: LengthMatchingPair[] = []
  for (const bus of params.buses) {
    if (bus.maxLengthSkew === undefined || bus.connectionNames.length < 2)
      continue
    const members = bus.connectionNames.map((name): BusMember => {
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
            {
              reason: "invalid_differential_pair",
              pairIndex: params.differentialPairs.findIndex((pair): boolean =>
                pair.connectionNames.flat().includes(route.connectionName),
              ),
              connectionName: route.connectionName,
              detail: `Owned hop also belongs to length-matched bus "${bus.busId}"`,
            },
            `hop "${route.connectionName}" also belongs to length-matched bus "${bus.busId}"`,
          )
        if (route.route.length < 2)
          throw new Error(
            `Length matching: bus route "${route.connectionName}" is incomplete`,
          )
        connections.set(route.connectionName, {
          name: route.connectionName,
          pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
            (point): ConnectionPoint => ({
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
          (total, route): number => total + getHighDensityRouteLength(route),
          0,
        ),
      }
    })
    const longest = members.reduce(
      (a, b): BusMember => (a.length > b.length ? a : b),
    )
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
      params.differentialPairs.flatMap((pair): string[] =>
        pair.connectionNames.flat(),
      ),
    )
    this.matcher = new LengthMatchingSolver({
      ...params,
      // Pathing recomputes electrical roots. Keep terminal obstacles in that
      // same identity space so tuning can retain its own pad escape leads.
      obstacles: params.obstacles.map(
        (obstacle): Obstacle => ({
          ...obstacle,
          connectedTo: [
            ...new Set([
              ...obstacle.connectedTo,
              ...params.hdRoutes.flatMap((route): string[] =>
                route.rootConnectionName &&
                obstacle.connectedTo.includes(route.connectionName)
                  ? [route.rootConnectionName]
                  : [],
              ),
            ]),
          ],
        }),
      ),
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
    try {
      this.matcher.step()
    } catch (error) {
      // Convert an exhausted owned-pair search into final, measured lane data.
      assertDifferentialPairRoutes(
        this.params,
        this.matcher.matchedHdRoutes,
        true,
      )
      throw error
    }
    if (this.matcher.failed) {
      assertDifferentialPairRoutes(
        this.params,
        this.matcher.matchedHdRoutes,
        true,
      )
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
    for (const bus of this.params.buses) {
      if (bus.maxLengthSkew === undefined || bus.connectionNames.length < 2)
        continue
      const lengths = bus.connectionNames.map((name): number => {
        const routes = this.matcher
          .getOutput()
          .matchedHdRoutes.filter(
            (route): boolean =>
              (route.rootConnectionName ?? route.connectionName) === name,
          )
        if (routes.length === 0)
          throw new Error(
            `Length matching: bus "${bus.busId}" lost routed geometry for connection "${name}"`,
          )
        return routes.reduce(
          (total, route): number => total + getHighDensityRouteLength(route),
          0,
        )
      })
      const skew = Math.max(...lengths) - Math.min(...lengths)
      if (skew > bus.maxLengthSkew + 1e-6)
        throw new Error(
          `Length matching: bus "${bus.busId}" routed length skew ${skew.toFixed(4)}mm exceeds ${bus.maxLengthSkew.toFixed(4)}mm`,
        )
    }
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
