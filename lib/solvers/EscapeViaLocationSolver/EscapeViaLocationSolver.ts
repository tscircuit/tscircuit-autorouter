import { distance, pointToBoxDistance } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  type ConnectionPoint,
  type Obstacle,
  type SimpleRouteConnection,
  type SimpleRouteJson,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInRect } from "lib/utils/isPointInRect"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getPointKey } from "lib/utils/getPointKey"
import { BaseSolver } from "../BaseSolver"
import { mergeConnections } from "../NetToPointPairsSolver/mergeConnections"
import { obstacleToSegments } from "../TraceKeepoutSolver/obstacleToSegments"

const ESCAPE_POINT_ID_PREFIX = "escape-via:"
const GEOMETRIC_TOLERANCE = 1e-4

type Point2D = {
  x: number
  y: number
}

export interface EscapeViaMetadata {
  pointId: string
  x: number
  y: number
  connectionName: string
  rootConnectionName: string
  sourcePointIndex: number
  sourcePointId?: string
  sourceLayer: string
  targetLayer: string
  targetPourKey: string
}

interface EscapeViaCandidate extends EscapeViaMetadata {
  score: number
}

interface PointOwner {
  connection: SimpleRouteConnection
  pointIndex: number
}

export interface EscapeViaLocationSolverOptions {
  viaDiameter?: number
  minTraceWidth?: number
  obstacleMargin?: number
}

interface PointPlacementPlan {
  point: ConnectionPoint
  pointOwner: PointOwner
  sourceObstacle: Obstacle | undefined
  candidateCount: number
}

const getObstacleKey = (obstacle: Obstacle) =>
  obstacle.obstacleId ??
  [
    obstacle.layers.join("."),
    obstacle.center.x.toFixed(4),
    obstacle.center.y.toFixed(4),
    obstacle.width.toFixed(4),
    obstacle.height.toFixed(4),
  ].join(":")

const pointMatches = (
  a: Point2D,
  b: Point2D,
  tolerance = GEOMETRIC_TOLERANCE,
) => distance(a, b) <= tolerance

export class EscapeViaLocationSolver extends BaseSolver {
  override getSolverName(): string {
    return "EscapeViaLocationSolver"
  }

  viaDiameter: number
  viaRadius: number
  minTraceWidth: number
  obstacleMargin: number
  escapeOffset: number
  requiredTraceClearance: number
  requiredViaToViaClearance: number
  outputSrj: SimpleRouteJson
  escapeViaMetadataByPointId: Map<string, EscapeViaMetadata>
  createdEscapeVias: EscapeViaMetadata[]
  nextEscapeViaIndex = 0

  constructor(
    public readonly ogSrj: SimpleRouteJson,
    opts: EscapeViaLocationSolverOptions = {},
  ) {
    super()
    this.viaDiameter = opts.viaDiameter ?? ogSrj.minViaDiameter ?? 0.3
    this.viaRadius = this.viaDiameter / 2
    this.minTraceWidth = opts.minTraceWidth ?? ogSrj.minTraceWidth
    this.obstacleMargin =
      opts.obstacleMargin ?? ogSrj.defaultObstacleMargin ?? 0.15
    this.escapeOffset =
      this.viaRadius + Math.max(this.minTraceWidth / 2, this.obstacleMargin)
    this.requiredTraceClearance =
      this.minTraceWidth / 2 + this.obstacleMargin / 2
    this.requiredViaToViaClearance = this.viaDiameter + this.obstacleMargin
    this.outputSrj = ogSrj
    this.escapeViaMetadataByPointId = new Map()
    this.createdEscapeVias = []
  }

  private getConnectionNetIds(connection: SimpleRouteConnection): Set<string> {
    return new Set(
      [
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
      ].filter((id): id is string => Boolean(id)),
    )
  }

  private obstacleMatchesConnectionNet(
    obstacle: Obstacle,
    connectionNetIds: Set<string>,
  ): boolean {
    return obstacle.connectedTo.some((id) => connectionNetIds.has(id))
  }

  private getObstacleZs(obstacle: Obstacle): number[] {
    if (obstacle.zLayers && obstacle.zLayers.length > 0) {
      return obstacle.zLayers
    }
    return obstacle.layers.map((layer) =>
      mapLayerNameToZ(layer, this.ogSrj.layerCount),
    )
  }

  private selectSourceObstacle(params: {
    point: ConnectionPoint
    sourceLayer: string
    connectionNetIds: Set<string>
  }): Obstacle | undefined {
    const { point, sourceLayer, connectionNetIds } = params
    return this.ogSrj.obstacles
      .filter(
        (obstacle) =>
          !obstacle.isCopperPour &&
          obstacle.layers.includes(sourceLayer) &&
          isPointInRect(point, obstacle),
      )
      .sort((a, b) => {
        const aDirectHit =
          a.connectedTo.includes(point.pointId ?? "") ||
          a.connectedTo.includes(point.pcb_port_id ?? "") ||
          this.obstacleMatchesConnectionNet(a, connectionNetIds)
        const bDirectHit =
          b.connectedTo.includes(point.pointId ?? "") ||
          b.connectedTo.includes(point.pcb_port_id ?? "") ||
          this.obstacleMatchesConnectionNet(b, connectionNetIds)
        if (aDirectHit !== bDirectHit) {
          return aDirectHit ? -1 : 1
        }
        return a.width * a.height - b.width * b.height
      })[0]
  }

  private getCandidatePositions(
    point: ConnectionPoint,
    sourceObstacle?: Obstacle,
  ): Point2D[] {
    if (!sourceObstacle) {
      return this.dedupeCandidatePositions([
        { x: point.x + this.escapeOffset, y: point.y },
        { x: point.x - this.escapeOffset, y: point.y },
        { x: point.x, y: point.y + this.escapeOffset },
        { x: point.x, y: point.y - this.escapeOffset },
        {
          x: point.x + this.escapeOffset,
          y: point.y + this.escapeOffset,
        },
        {
          x: point.x + this.escapeOffset,
          y: point.y - this.escapeOffset,
        },
        {
          x: point.x - this.escapeOffset,
          y: point.y + this.escapeOffset,
        },
        {
          x: point.x - this.escapeOffset,
          y: point.y - this.escapeOffset,
        },
      ])
    }

    const minX = sourceObstacle.center.x - sourceObstacle.width / 2
    const maxX = sourceObstacle.center.x + sourceObstacle.width / 2
    const minY = sourceObstacle.center.y - sourceObstacle.height / 2
    const maxY = sourceObstacle.center.y + sourceObstacle.height / 2
    const leftX = minX - this.escapeOffset
    const rightX = maxX + this.escapeOffset
    const bottomY = minY - this.escapeOffset
    const topY = maxY + this.escapeOffset
    const ySamples = this.getEdgeSamples(minY, maxY, point.y)
    const xSamples = this.getEdgeSamples(minX, maxX, point.x)
    const candidates: Point2D[] = []

    for (const y of ySamples) {
      candidates.push({ x: leftX, y }, { x: rightX, y })
    }
    for (const x of xSamples) {
      candidates.push({ x, y: bottomY }, { x, y: topY })
    }

    return this.dedupeCandidatePositions(candidates)
  }

  private dedupeCandidatePositions(candidates: Point2D[]): Point2D[] {
    const deduped: Point2D[] = []
    for (const candidate of candidates) {
      if (deduped.some((existing) => pointMatches(existing, candidate))) {
        continue
      }
      deduped.push(candidate)
    }
    return deduped
  }

  private pushEdgeSample(
    samples: number[],
    value: number,
    min: number,
    max: number,
  ) {
    const clampedValue = Math.max(min, Math.min(max, value))
    if (
      samples.some(
        (existingValue) =>
          Math.abs(existingValue - clampedValue) <= GEOMETRIC_TOLERANCE,
      )
    ) {
      return
    }
    samples.push(clampedValue)
  }

  private getEdgeSamples(
    min: number,
    max: number,
    preferred: number,
  ): number[] {
    const samples: number[] = []
    const span = max - min
    this.pushEdgeSample(samples, preferred, min, max)

    if (span <= GEOMETRIC_TOLERANCE) {
      return samples
    }

    this.pushEdgeSample(samples, min, min, max)
    this.pushEdgeSample(samples, max, min, max)
    this.pushEdgeSample(samples, (min + max) / 2, min, max)

    const clampedPreferred = Math.max(min, Math.min(max, preferred))
    const step = Math.max(this.requiredViaToViaClearance, GEOMETRIC_TOLERANCE)
    const stepCount = Math.ceil(span / step)

    for (let i = 1; i <= stepCount; i++) {
      const offset = i * step
      this.pushEdgeSample(samples, clampedPreferred + offset, min, max)
      this.pushEdgeSample(samples, clampedPreferred - offset, min, max)
    }

    return samples
  }

  private isInsideBoard(candidate: Point2D): boolean {
    return (
      candidate.x >= this.ogSrj.bounds.minX + this.viaRadius &&
      candidate.x <= this.ogSrj.bounds.maxX - this.viaRadius &&
      candidate.y >= this.ogSrj.bounds.minY + this.viaRadius &&
      candidate.y <= this.ogSrj.bounds.maxY - this.viaRadius
    )
  }

  private hasClearEscapePath(params: {
    sourcePoint: ConnectionPoint
    candidate: Point2D
    sourceLayer: string
    sourceObstacle?: Obstacle
  }): boolean {
    const { sourcePoint, candidate, sourceLayer, sourceObstacle } = params
    for (const obstacle of this.ogSrj.obstacles) {
      if (obstacle === sourceObstacle) continue
      if (!obstacle.layers.includes(sourceLayer)) continue

      if (isPointInRect(candidate, obstacle)) {
        return false
      }

      const obstacleSegments = obstacleToSegments(obstacle)
      const minDistance = Math.min(
        ...obstacleSegments.map((segment) =>
          minimumDistanceBetweenSegments(
            sourcePoint,
            candidate,
            segment.start,
            segment.end,
          ),
        ),
      )

      if (minDistance + GEOMETRIC_TOLERANCE < this.requiredTraceClearance) {
        return false
      }
    }

    return true
  }

  private getMinBlockingClearance(params: {
    candidate: Point2D
    connectionNetIds: Set<string>
    sourceZ: number
    targetZ: number
  }): number {
    const { candidate, connectionNetIds, sourceZ, targetZ } = params
    const spanMinZ = Math.min(sourceZ, targetZ)
    const spanMaxZ = Math.max(sourceZ, targetZ)
    let minClearance = Number.POSITIVE_INFINITY

    for (const obstacle of this.ogSrj.obstacles) {
      const obstacleZs = this.getObstacleZs(obstacle)
      if (!obstacleZs.some((z) => z >= spanMinZ && z <= spanMaxZ)) {
        continue
      }

      if (obstacle.isCopperPour && !obstacleZs.includes(sourceZ)) {
        continue
      }

      const clearance = pointToBoxDistance(candidate, obstacle) - this.viaRadius
      minClearance = Math.min(minClearance, clearance)

      if (minClearance + GEOMETRIC_TOLERANCE < this.obstacleMargin) {
        return minClearance
      }
    }

    return minClearance
  }

  private getMinPlacedEscapeViaClearance(candidate: Point2D): number {
    let minClearance = Number.POSITIVE_INFINITY
    for (const existingEscapeVia of this.createdEscapeVias) {
      const clearance =
        distance(candidate, existingEscapeVia) - this.viaDiameter
      minClearance = Math.min(minClearance, clearance)
      if (minClearance + GEOMETRIC_TOLERANCE < this.obstacleMargin) {
        return minClearance
      }
    }
    return minClearance
  }

  private selectPointOwner(params: {
    point: ConnectionPoint
    groupConnections: SimpleRouteConnection[]
    matchingCopperPours: Obstacle[]
  }): PointOwner | null {
    const { point, groupConnections, matchingCopperPours } = params
    const pointKey = getPointKey(point)

    const owners = groupConnections
      .map((connection) => ({
        connection,
        pointIndex: connection.pointsToConnect.findIndex(
          (candidatePoint) => getPointKey(candidatePoint) === pointKey,
        ),
      }))
      .filter(
        (candidate): candidate is PointOwner => candidate.pointIndex !== -1,
      )

    if (owners.length === 0) {
      return null
    }

    owners.sort((a, b) => {
      const aDirectMatch = matchingCopperPours.some((obstacle) =>
        this.obstacleMatchesConnectionNet(
          obstacle,
          this.getConnectionNetIds(a.connection),
        ),
      )
      const bDirectMatch = matchingCopperPours.some((obstacle) =>
        this.obstacleMatchesConnectionNet(
          obstacle,
          this.getConnectionNetIds(b.connection),
        ),
      )

      if (aDirectMatch !== bDirectMatch) {
        return aDirectMatch ? -1 : 1
      }

      return a.pointIndex - b.pointIndex
    })

    return owners[0]!
  }

  private findBestEscapeViaCandidate(params: {
    connection: SimpleRouteConnection
    point: ConnectionPoint
    pointIndex: number
    matchingCopperPours: Obstacle[]
    connectionNetIds: Set<string>
    sourceObstacle?: Obstacle
  }): EscapeViaCandidate | null {
    const {
      connection,
      point,
      pointIndex,
      matchingCopperPours,
      connectionNetIds,
      sourceObstacle: sourceObstacleOverride,
    } = params

    if (!isSingleLayerConnectionPoint(point)) {
      return null
    }

    const sourceLayer = point.layer
    const sourceZ = mapLayerNameToZ(sourceLayer, this.ogSrj.layerCount)
    const sourceObstacle =
      sourceObstacleOverride ??
      this.selectSourceObstacle({
        point,
        sourceLayer,
        connectionNetIds,
      })
    const candidates = this.getCandidatePositions(point, sourceObstacle)

    let bestCandidate: EscapeViaCandidate | null = null

    for (const copperPour of matchingCopperPours) {
      const targetLayer = copperPour.layers[0]
      if (!targetLayer || targetLayer === sourceLayer) continue

      const targetZ = mapLayerNameToZ(targetLayer, this.ogSrj.layerCount)
      const targetPourKey = getObstacleKey(copperPour)

      for (const candidate of candidates) {
        if (!this.isInsideBoard(candidate)) continue
        if (!isPointInRect(candidate, copperPour)) continue
        if (
          !this.hasClearEscapePath({
            sourcePoint: point,
            candidate,
            sourceLayer,
            sourceObstacle,
          })
        ) {
          continue
        }

        const minClearance = this.getMinBlockingClearance({
          candidate,
          connectionNetIds,
          sourceZ,
          targetZ,
        })
        if (minClearance + GEOMETRIC_TOLERANCE < this.obstacleMargin) continue
        const minPlacedEscapeViaClearance =
          this.getMinPlacedEscapeViaClearance(candidate)
        if (
          minPlacedEscapeViaClearance + GEOMETRIC_TOLERANCE <
          this.obstacleMargin
        ) {
          continue
        }

        const score =
          minClearance * 100 -
          distance(point, candidate) -
          Math.abs(targetZ - sourceZ) * 0.5 +
          (Number.isFinite(minPlacedEscapeViaClearance)
            ? Math.min(
                minPlacedEscapeViaClearance,
                this.requiredViaToViaClearance,
              ) * 10
            : 0)

        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            pointId: `${ESCAPE_POINT_ID_PREFIX}${connection.name}:${point.pointId ?? `p${pointIndex}`}:${targetLayer}:${this.nextEscapeViaIndex++}`,
            x: candidate.x,
            y: candidate.y,
            connectionName: connection.name,
            rootConnectionName:
              connection.rootConnectionName ?? connection.name,
            sourcePointIndex: pointIndex,
            sourcePointId: point.pointId,
            sourceLayer,
            targetLayer,
            targetPourKey,
            score,
          }
        }
      }
    }

    return bestCandidate
  }

  private buildPointPlacementPlans(params: {
    mergedConnection: SimpleRouteConnection
    groupConnections: SimpleRouteConnection[]
    matchingCopperPours: Obstacle[]
    connectionNetIds: Set<string>
  }): PointPlacementPlan[] {
    const {
      mergedConnection,
      groupConnections,
      matchingCopperPours,
      connectionNetIds,
    } = params

    const pointPlacementPlans: PointPlacementPlan[] = []

    for (const point of mergedConnection.pointsToConnect) {
      const pointOwner = this.selectPointOwner({
        point,
        groupConnections,
        matchingCopperPours,
      })
      if (!pointOwner) continue

      const sourceObstacle = isSingleLayerConnectionPoint(point)
        ? this.selectSourceObstacle({
            point,
            sourceLayer: point.layer,
            connectionNetIds,
          })
        : undefined
      const candidateCount = isSingleLayerConnectionPoint(point)
        ? this.getCandidatePositions(point, sourceObstacle).length
        : 0

      pointPlacementPlans.push({
        point,
        pointOwner,
        sourceObstacle,
        candidateCount,
      })
    }

    return pointPlacementPlans.sort((a, b) => {
      if (a.candidateCount !== b.candidateCount) {
        return a.candidateCount - b.candidateCount
      }

      const aArea =
        (a.sourceObstacle?.width ?? 0) * (a.sourceObstacle?.height ?? 0)
      const bArea =
        (b.sourceObstacle?.width ?? 0) * (b.sourceObstacle?.height ?? 0)
      if (aArea !== bArea) {
        return aArea - bArea
      }

      return a.pointOwner.pointIndex - b.pointOwner.pointIndex
    })
  }

  _step() {
    const copperPours = this.ogSrj.obstacles.filter(
      (obstacle) => obstacle.isCopperPour,
    )
    const originalConnections = this.ogSrj.connections
    const originalConnectionByName = new Map(
      originalConnections.map((connection) => [connection.name, connection]),
    )
    const newConnections = originalConnections.map((connection) =>
      structuredClone(connection),
    )
    const clonedConnectionByName = new Map(
      newConnections.map((connection) => [connection.name, connection]),
    )
    const mergedConnections = mergeConnections([...originalConnections])

    for (const mergedConnection of mergedConnections) {
      const groupConnectionNames = mergedConnection.mergedConnectionNames ?? [
        mergedConnection.name,
      ]
      const groupConnections = groupConnectionNames
        .map((connectionName) => originalConnectionByName.get(connectionName))
        .filter(
          (connection): connection is SimpleRouteConnection =>
            connection !== undefined,
        )

      if (groupConnections.length === 0) {
        continue
      }

      const connectionNetIds = new Set<string>()
      for (const groupConnection of groupConnections) {
        for (const netId of this.getConnectionNetIds(groupConnection)) {
          connectionNetIds.add(netId)
        }
      }

      const matchingCopperPours = copperPours.filter((obstacle) =>
        this.obstacleMatchesConnectionNet(obstacle, connectionNetIds),
      )
      if (matchingCopperPours.length === 0) {
        continue
      }

      const groupedEscapePointIds = new Map<string, string[]>()
      const representativeConnectionNameByPourKey = new Map<string, string>()
      const pointPlacementPlans = this.buildPointPlacementPlans({
        mergedConnection,
        groupConnections,
        matchingCopperPours,
        connectionNetIds,
      })

      for (const { point, pointOwner, sourceObstacle } of pointPlacementPlans) {
        const escapeViaCandidate = this.findBestEscapeViaCandidate({
          connection: pointOwner.connection,
          point,
          pointIndex: pointOwner.pointIndex,
          matchingCopperPours,
          connectionNetIds,
          sourceObstacle,
        })

        if (!escapeViaCandidate) continue

        const clonedConnection = clonedConnectionByName.get(
          pointOwner.connection.name,
        )
        if (!clonedConnection) continue

        const alreadyExists = clonedConnection.pointsToConnect.some(
          (existing) =>
            isSingleLayerConnectionPoint(existing) &&
            existing.layer === escapeViaCandidate.sourceLayer &&
            pointMatches(existing, escapeViaCandidate),
        )
        if (alreadyExists) continue

        clonedConnection.pointsToConnect.push({
          x: escapeViaCandidate.x,
          y: escapeViaCandidate.y,
          layer: escapeViaCandidate.sourceLayer,
          pointId: escapeViaCandidate.pointId,
          terminalVia: {
            toLayer: escapeViaCandidate.targetLayer,
            viaDiameter: this.viaDiameter,
          },
        } satisfies ConnectionPoint)
        this.escapeViaMetadataByPointId.set(
          escapeViaCandidate.pointId,
          escapeViaCandidate,
        )
        this.createdEscapeVias.push(escapeViaCandidate)

        const pointIds = groupedEscapePointIds.get(
          escapeViaCandidate.targetPourKey,
        )
        if (pointIds) {
          pointIds.push(escapeViaCandidate.pointId)
        } else {
          groupedEscapePointIds.set(escapeViaCandidate.targetPourKey, [
            escapeViaCandidate.pointId,
          ])
        }

        if (
          !representativeConnectionNameByPourKey.has(
            escapeViaCandidate.targetPourKey,
          )
        ) {
          representativeConnectionNameByPourKey.set(
            escapeViaCandidate.targetPourKey,
            pointOwner.connection.name,
          )
        }
      }

      for (const [targetPourKey, pointIds] of groupedEscapePointIds.entries()) {
        if (pointIds.length <= 1) continue

        const representativeConnectionName =
          representativeConnectionNameByPourKey.get(targetPourKey)
        if (!representativeConnectionName) continue

        const representativeConnection = clonedConnectionByName.get(
          representativeConnectionName,
        )
        if (!representativeConnection) continue

        representativeConnection.externallyConnectedPointIds = [
          ...(representativeConnection.externallyConnectedPointIds ?? []),
          pointIds,
        ]
      }
    }

    this.outputSrj = {
      ...structuredClone(this.ogSrj),
      connections: newConnections,
    }
    this.solved = true
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return structuredClone(this.outputSrj)
  }

  getEscapeViaMetadataByPointId(): Map<string, EscapeViaMetadata> {
    return new Map(this.escapeViaMetadataByPointId)
  }

  override visualize(): GraphicsObject {
    return {
      title: "Escape Via Location Solver",
      points: this.outputSrj.connections.flatMap((connection) =>
        connection.pointsToConnect.map((point) => ({
          x: point.x,
          y: point.y,
          color:
            point.pointId?.startsWith(ESCAPE_POINT_ID_PREFIX) === true
              ? "#0f766e"
              : "#dc2626",
          label:
            point.pointId?.startsWith(ESCAPE_POINT_ID_PREFIX) === true
              ? `${connection.name}\nescape via`
              : connection.name,
        })),
      ),
      lines: this.createdEscapeVias.map((escapeVia) => {
        const sourcePoint =
          this.outputSrj.connections.find(
            (connection) => connection.name === escapeVia.connectionName,
          )?.pointsToConnect[escapeVia.sourcePointIndex] ?? null

        return {
          points: sourcePoint
            ? [
                { x: sourcePoint.x, y: sourcePoint.y },
                { x: escapeVia.x, y: escapeVia.y },
              ]
            : [{ x: escapeVia.x, y: escapeVia.y }],
          strokeColor: "#0f766e",
        }
      }),
      circles: this.createdEscapeVias.map((escapeVia) => ({
        center: { x: escapeVia.x, y: escapeVia.y },
        radius: this.viaRadius,
        strokeColor: "#0f766e",
        label: `${escapeVia.connectionName}\n${escapeVia.targetLayer}`,
      })),
      rects: this.ogSrj.obstacles
        .filter((obstacle) => !obstacle.isCopperPour)
        .map((obstacle) => ({
          ...obstacle,
          fill: "rgba(220,38,38,0.12)",
        })),
    }
  }
}
