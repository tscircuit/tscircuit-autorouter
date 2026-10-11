import {
  TraceSimplificationSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"

type ObstaclePatternInput = {
  connMap: ConnectivityMap
  multilayerObstacles: Obstacle[]
  sameNetObstaclesByConnection: Map<string, Map<string | undefined, Obstacle[]>>
  connectivitySnapshot: Array<[string, string]>
  obstacleConnectionSnapshots: string[][]
}

const VIA_INSIDE_OBSTACLE_TOLERANCE = 1e-6

function pointInsideObstacle(
  point: { x: number; y: number },
  obstacle: Obstacle,
): boolean {
  return (
    Math.abs(point.x - obstacle.center.x) <=
      obstacle.width / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE &&
    Math.abs(point.y - obstacle.center.y) <=
      obstacle.height / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE
  )
}

/** Reuses static route/obstacle connectivity across simplification phases. */
export class CachedTraceSimplificationSolver extends TraceSimplificationSolver {
  // The base constructor dispatches to the marker below. A declaration avoids
  // overwriting its lazily initialized cache when derived fields initialize.
  private declare obstaclePatternInput?: ObstaclePatternInput

  private initializeObstaclePatternInput(): ObstaclePatternInput {
    // The pinned dependency stores this private normalized configuration before
    // its first virtual marker call. Reuse that geometry for every marker pass.
    const config = (
      this as unknown as {
        simplificationConfig: ConstructorParameters<
          typeof TraceSimplificationSolver
        >[0]
      }
    ).simplificationConfig
    const multilayerObstacles = config.obstacles.filter(
      (obstacle) =>
        (obstacle.__zLayers?.length ?? obstacle.layers?.length ?? 0) > 1,
    )
    const input: ObstaclePatternInput = {
      connMap: config.connMap,
      multilayerObstacles,
      sameNetObstaclesByConnection: new Map(),
      connectivitySnapshot: Object.entries(config.connMap.idToNetMap),
      obstacleConnectionSnapshots: multilayerObstacles.map((obstacle) => [
        ...obstacle.connectedTo,
      ]),
    }
    this.obstaclePatternInput = input
    return input
  }

  private invalidateChangedObstaclePatterns(input: ObstaclePatternInput): void {
    const connectivity = Object.entries(input.connMap.idToNetMap)
    let changed = connectivity.length !== input.connectivitySnapshot.length
    if (!changed) {
      for (let i = 0; i < connectivity.length; i++) {
        const current = connectivity[i]
        const previous = input.connectivitySnapshot[i]
        if (current[0] !== previous[0] || current[1] !== previous[1]) {
          changed = true
          break
        }
      }
    }
    if (!changed) {
      for (let i = 0; i < input.multilayerObstacles.length; i++) {
        const connectedTo = input.multilayerObstacles[i].connectedTo
        const previous = input.obstacleConnectionSnapshots[i]
        if (
          connectedTo.length !== previous.length ||
          connectedTo.some((id, index) => id !== previous[index])
        ) {
          changed = true
          break
        }
      }
    }
    if (changed) {
      // Public connectivity maps and connectedTo arrays can change between
      // marker calls. Rebuild subsets against the current relationships.
      input.sameNetObstaclesByConnection.clear()
      input.connectivitySnapshot = connectivity
      input.obstacleConnectionSnapshots = input.multilayerObstacles.map(
        (obstacle) => [...obstacle.connectedTo],
      )
    }
  }

  private getSameNetMultilayerObstacles(
    route: HighDensityRoute,
  ): ReadonlyArray<Obstacle> {
    const input = this.obstaclePatternInput
    if (!input) {
      throw new Error(
        "Trace simplification obstacle patterns are not initialized",
      )
    }
    let obstaclesByRoot = input.sameNetObstaclesByConnection.get(
      route.connectionName,
    )
    if (!obstaclesByRoot) {
      obstaclesByRoot = new Map()
      input.sameNetObstaclesByConnection.set(
        route.connectionName,
        obstaclesByRoot,
      )
    }
    let obstacles = obstaclesByRoot.get(route.rootConnectionName)
    if (!obstacles) {
      // Preserve board obstacle order: overlapping through-obstacle segments
      // retain the first matching obstacle's Circuit JSON metadata.
      obstacles = input.multilayerObstacles.filter((obstacle) =>
        obstacle.connectedTo.some(
          (connectedId) =>
            connectedId === route.connectionName ||
            connectedId === route.rootConnectionName ||
            input.connMap.areIdsConnected(route.connectionName, connectedId) ||
            (route.rootConnectionName !== undefined &&
              input.connMap.areIdsConnected(
                route.rootConnectionName,
                connectedId,
              )),
        ),
      )
      obstaclesByRoot.set(route.rootConnectionName, obstacles)
    }
    return obstacles
  }

  override markThroughObstacleSegments(
    routes: ReadonlyArray<HighDensityRoute>,
  ): HighDensityRoute[] {
    const input =
      this.obstaclePatternInput ?? this.initializeObstaclePatternInput()
    this.invalidateChangedObstaclePatterns(input)
    return routes.map((route) => {
      let obstacles: ReadonlyArray<Obstacle> | undefined
      return {
        ...route,
        route: route.route.map((point, index, points) => {
          const nextPoint = points[index + 1]
          const sameNetObstacle =
            nextPoint &&
            point.z !== nextPoint.z &&
            (obstacles ??= this.getSameNetMultilayerObstacles(route)).find(
              (obstacle) =>
                pointInsideObstacle(point, obstacle) &&
                pointInsideObstacle(nextPoint, obstacle),
            )
          if (sameNetObstacle) {
            return {
              ...point,
              toNextSegmentType: "through_obstacle" as const,
              ...(sameNetObstacle.circuitJsonMetadata
                ? {
                    toNextSegmentCircuitJsonMetadata:
                      sameNetObstacle.circuitJsonMetadata,
                  }
                : {}),
            }
          }
          const finalizedPoint = { ...point }
          delete finalizedPoint.toNextSegmentType
          delete finalizedPoint.toNextSegmentCircuitJsonMetadata
          return finalizedPoint
        }),
        vias: route.vias.filter(
          (via) =>
            !(obstacles ??= this.getSameNetMultilayerObstacles(route)).some(
              (obstacle) => pointInsideObstacle(via, obstacle),
            ),
        ),
      }
    })
  }
}
