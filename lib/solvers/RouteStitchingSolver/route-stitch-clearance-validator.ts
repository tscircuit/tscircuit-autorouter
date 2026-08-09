import {
  pointToSegmentDistance,
  segmentToBoxMinDistance,
  type Point3,
} from "@tscircuit/math-utils"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export type StitchSegment = {
  connectionName: string
  start: Point3
  end: Point3
  traceThickness: number
}

export type IsStitchSegmentClear = (stitchSegment: StitchSegment) => boolean

type ConnectionName = HighDensityIntraNodeRoute["connectionName"]
type RootConnectionName = NonNullable<
  HighDensityIntraNodeRoute["rootConnectionName"]
>

type RouteSegment = StitchSegment

type RouteVia = {
  connectionName: ConnectionName
  x: number
  y: number
  diameter: number
}

type LayeredObstacle = Obstacle & { __zLayers: number[] }

const DEFAULT_AUTOROUTING_CLEARANCE = 0.1
const CLEARANCE_TOLERANCE = 1e-6

/**
 * Allows a stitch to leave copper that already violates clearance at one
 * endpoint, provided the stitch never gets closer and exits the violation.
 */
const preservesEndpointClearance = ({
  startGap,
  endGap,
  segmentGap,
  requiredGap,
}: {
  startGap: number
  endGap: number
  segmentGap: number
  requiredGap: number
}): boolean => {
  const escapesFromStart =
    startGap < requiredGap &&
    endGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= startGap - CLEARANCE_TOLERANCE
  const escapesFromEnd =
    endGap < requiredGap &&
    startGap >= requiredGap - CLEARANCE_TOLERANCE &&
    segmentGap >= endGap - CLEARANCE_TOLERANCE
  const preservesExistingViolation =
    startGap < requiredGap &&
    endGap < requiredGap &&
    segmentGap >= Math.min(startGap, endGap) - CLEARANCE_TOLERANCE

  return escapesFromStart || escapesFromEnd || preservesExistingViolation
}

export class RouteStitchClearanceValidator {
  private readonly minClearance: number
  private readonly obstacleClearance: number
  private readonly obstacles: LayeredObstacle[]
  private readonly rootsByConnection = new Map<
    ConnectionName,
    Set<RootConnectionName>
  >()
  private readonly connectionIdsByName: ReadonlyMap<
    ConnectionName,
    ReadonlySet<string>
  >
  private readonly ownedComponentIdsByConnection = new Map<
    ConnectionName,
    ReadonlySet<string>
  >()
  private readonly segments: RouteSegment[] = []
  private readonly vias: RouteVia[] = []

  constructor({
    hdRoutes,
    obstacles = [],
    layerCount = 2,
    minClearance = DEFAULT_AUTOROUTING_CLEARANCE,
    obstacleClearance = minClearance,
    connectionIdsByName = new Map(),
  }: {
    hdRoutes: HighDensityIntraNodeRoute[]
    obstacles?: Obstacle[]
    layerCount?: number
    minClearance?: number
    obstacleClearance?: number
    connectionIdsByName?: ReadonlyMap<ConnectionName, ReadonlySet<string>>
  }) {
    this.minClearance = minClearance
    this.obstacleClearance = obstacleClearance
    this.obstacles = createObjectsWithZLayers(obstacles, layerCount)
    this.connectionIdsByName = connectionIdsByName
    for (const [connectionName, connectionIds] of connectionIdsByName) {
      const ownedComponentIds = new Set<string>()
      for (const obstacle of this.obstacles) {
        if (
          obstacle.componentId &&
          obstacle.connectedTo.some((connectedId) =>
            connectionIds.has(connectedId),
          )
        ) {
          ownedComponentIds.add(obstacle.componentId)
        }
      }
      this.ownedComponentIdsByConnection.set(connectionName, ownedComponentIds)
    }
    for (const hdRoute of hdRoutes) {
      this.addRoute(hdRoute)
    }
  }

  addRoute(hdRoute: HighDensityIntraNodeRoute): void {
    const roots =
      this.rootsByConnection.get(hdRoute.connectionName) ?? new Set()
    roots.add(hdRoute.rootConnectionName ?? hdRoute.connectionName)
    this.rootsByConnection.set(hdRoute.connectionName, roots)

    for (let index = 0; index < hdRoute.route.length - 1; index += 1) {
      const start = hdRoute.route[index]!
      const end = hdRoute.route[index + 1]!
      if (start.z !== end.z) continue
      if (start.insideJumperPad && end.insideJumperPad) continue
      this.segments.push({
        connectionName: hdRoute.connectionName,
        start,
        end,
        traceThickness: hdRoute.traceThickness,
      })
    }

    for (const via of hdRoute.vias) {
      this.vias.push({
        connectionName: hdRoute.connectionName,
        x: via.x,
        y: via.y,
        diameter: hdRoute.viaDiameter,
      })
    }
  }

  private areSameNet(
    firstConnectionName: ConnectionName,
    secondConnectionName: ConnectionName,
  ): boolean {
    if (firstConnectionName === secondConnectionName) return true
    const firstRoots = this.rootsByConnection.get(firstConnectionName)
    const secondRoots = this.rootsByConnection.get(secondConnectionName)
    if (!firstRoots || !secondRoots) return false
    return [...firstRoots].some((root) => secondRoots.has(root))
  }

  private isObstacleOnSameNet(
    connectionName: ConnectionName,
    obstacle: Obstacle,
  ): boolean {
    const connectionIds = new Set<string>([
      connectionName,
      ...(this.rootsByConnection.get(connectionName) ?? []),
      ...(this.connectionIdsByName.get(connectionName) ?? []),
    ])
    return obstacle.connectedTo.some((connectedId) =>
      connectionIds.has(connectedId),
    )
  }

  private isObstacleInsideTerminalComponent(
    connectionName: ConnectionName,
    obstacle: Obstacle,
  ): boolean {
    return Boolean(
      obstacle.componentId &&
        this.ownedComponentIdsByConnection
          .get(connectionName)
          ?.has(obstacle.componentId),
    )
  }

  isSegmentClear({
    connectionName,
    start,
    end,
    traceThickness,
  }: StitchSegment): boolean {
    const traceRadius = traceThickness / 2

    for (const segment of this.segments) {
      if (segment.start.z !== start.z) continue
      if (this.areSameNet(connectionName, segment.connectionName)) continue

      const requiredGap =
        this.minClearance + traceRadius + segment.traceThickness / 2
      const segmentGap = minimumDistanceBetweenSegments(
        start,
        end,
        segment.start,
        segment.end,
      )
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: pointToSegmentDistance(start, segment.start, segment.end),
          endGap: pointToSegmentDistance(end, segment.start, segment.end),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    for (const via of this.vias) {
      if (this.areSameNet(connectionName, via.connectionName)) continue

      const requiredGap = this.minClearance + traceRadius + via.diameter / 2
      const segmentGap = pointToSegmentDistance(via, start, end)
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: Math.hypot(start.x - via.x, start.y - via.y),
          endGap: Math.hypot(end.x - via.x, end.y - via.y),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    for (const obstacle of this.obstacles) {
      if (!obstacle.componentId) continue
      if (!obstacle.__zLayers.includes(start.z)) continue
      if (this.isObstacleOnSameNet(connectionName, obstacle)) continue
      if (this.isObstacleInsideTerminalComponent(connectionName, obstacle))
        continue

      const requiredGap = this.obstacleClearance + traceRadius
      const segmentGap = segmentToBoxMinDistance(start, end, obstacle)
      if (
        segmentGap < requiredGap &&
        !preservesEndpointClearance({
          startGap: segmentToBoxMinDistance(start, start, obstacle),
          endGap: segmentToBoxMinDistance(end, end, obstacle),
          segmentGap,
          requiredGap,
        })
      ) {
        return false
      }
    }

    return true
  }
}
