import { distance, doSegmentsIntersect } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import type { GraphicsObject } from "graphics-debug"
import {
  Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"

export type FutureConnection = {
  connectionName: string
  rootConnectionName?: string
  regionId?: string
  points: { x: number; y: number; z: number }[]
}

const connectionLabel = (
  connectionName: string,
  rootConnectionName?: string,
  extraLines: string[] = [],
) =>
  [
    connectionName,
    rootConnectionName
      ? `rootConnectionName: ${rootConnectionName}`
      : undefined,
    ...extraLines,
  ]
    .filter(Boolean)
    .join("\n")

export class SingleHighDensityRouteSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleHighDensityRouteSolver"
  }

  obstacleRoutes: HighDensityIntraNodeRoute[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  boundsSize: { width: number; height: number }
  boundsCenter: { x: number; y: number }
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
  straightLineDistance: number

  viaDiameter: number
  traceThickness: number
  obstacleMargin: number
  layerCount: number
  availableZ: number[]
  minCellSize = 0.05
  cellStep = 0.05
  GREEDY_MULTIPLER = 1.1
  numRoutes: number

  VIA_PENALTY_FACTOR = 0.3
  CELL_SIZE_FACTOR: number
  NEARBY_SEGMENT_CLEARANCE: number

  exploredNodes: Set<number>
  viasInPathByNode = new WeakMap<Node, { x: number; y: number }[]>()

  gridMinXIndex: number
  gridMinYIndex: number
  gridWidth: number
  gridHeight: number

  candidates: SingleRouteCandidatePriorityQueue

  connectionName: string
  rootConnectionName?: string
  regionId?: string
  solvedPath: HighDensityIntraNodeRoute | null = null

  futureConnections: FutureConnection[]
  hyperParameters: Partial<HighDensityHyperParameters>

  connMap?: ConnectivityMap

  obstacleSegments: IndexedObstacleSegment[] = []
  obstacleSegmentIndex: Flatbush | null = null
  obstacleSegmentsByLayer = new Map<number, IndexedObstacleSegment[]>()
  obstacleSegmentIndexByLayer = new Map<number, Flatbush>()
  obstacleVias: IndexedObstacleVia[] = []
  obstacleViaIndex: Flatbush | null = null
  freePlanarObstaclePoints = new Map<number, FreePlanarObstaclePoint>()
  cachedPlanarTraceProximity: number | undefined
  cachedPlanarViaProximity: number | undefined

  /** For debugging/animating the exploration */
  debug_exploredNodesOrdered: Array<{
    key: number
    x: number
    y: number
    z: number
  }>
  debug_nodesTooCloseToObstacle: Set<number>
  debug_nodePathToParentIntersectsObstacle: Set<number>

  debugEnabled: boolean

  initialNodeGridOffset: { x: number; y: number }

  constructor(opts: {
    connectionName: string
    rootConnectionName?: string
    regionId?: string
    obstacleRoutes: HighDensityIntraNodeRoute[]
    minDistBetweenEnteringPoints: number
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
    viaDiameter?: number
    traceThickness?: number
    obstacleMargin?: number
    layerCount?: number
    availableZ?: number[]
    futureConnections?: FutureConnection[]
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
    nearbySegmentClearance?: number
    captureSearchDebug?: boolean
  }) {
    super()
    this.bounds = opts.bounds
    this.connMap = opts.connMap
    this.hyperParameters = opts.hyperParameters ?? {}
    this.CELL_SIZE_FACTOR = this.hyperParameters.CELL_SIZE_FACTOR ?? 1
    this.boundsSize = {
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    }
    this.boundsCenter = {
      x: (this.bounds.minX + this.bounds.maxX) / 2,
      y: (this.bounds.minY + this.bounds.maxY) / 2,
    }
    this.connectionName = opts.connectionName
    this.rootConnectionName = opts.rootConnectionName
    this.regionId = opts.regionId
    this.obstacleRoutes = opts.obstacleRoutes
    this.A = opts.A
    this.B = opts.B
    this.viaDiameter = opts.viaDiameter ?? 0.3
    this.traceThickness = opts.traceThickness ?? 0.15
    this.obstacleMargin = opts.obstacleMargin ?? 0.15
    this.layerCount = opts.layerCount ?? 2
    this.availableZ =
      opts.availableZ && opts.availableZ.length > 0
        ? [...new Set(opts.availableZ)].sort((a, b) => a - b)
        : Array.from({ length: this.layerCount }, (_, index) => index)
    this.exploredNodes = new Set()
    this.straightLineDistance = distance(this.A, this.B)
    this.futureConnections = opts.futureConnections ?? []
    this.NEARBY_SEGMENT_CLEARANCE = opts.nearbySegmentClearance ?? 0.15
    this.debugEnabled = opts.captureSearchDebug ?? true
    this.MAX_ITERATIONS = 10e3 // 5000

    this.debug_exploredNodesOrdered = []
    this.debug_nodesTooCloseToObstacle = new Set()
    this.debug_nodePathToParentIntersectsObstacle = new Set()
    this.numRoutes = this.obstacleRoutes.length + this.futureConnections.length
    this.buildObstacleIndexes()
    const bestRowOrColumnCount = Math.ceil(5 * (this.numRoutes + 1))
    let numXCells = this.boundsSize.width / this.cellStep
    let numYCells = this.boundsSize.height / this.cellStep

    while (numXCells * numYCells > bestRowOrColumnCount ** 2) {
      if (this.cellStep * 2 > opts.minDistBetweenEnteringPoints) {
        break
      }
      this.cellStep *= 2
      numXCells = this.boundsSize.width / this.cellStep
      numYCells = this.boundsSize.height / this.cellStep
    }

    this.cellStep *= this.CELL_SIZE_FACTOR

    this.gridMinXIndex = Math.round(this.bounds.minX / this.cellStep) - 1
    this.gridMinYIndex = Math.round(this.bounds.minY / this.cellStep) - 1
    const gridMaxXIndex = Math.round(this.bounds.maxX / this.cellStep) + 1
    const gridMaxYIndex = Math.round(this.bounds.maxY / this.cellStep) + 1
    this.gridWidth = gridMaxXIndex - this.gridMinXIndex + 1
    this.gridHeight = gridMaxYIndex - this.gridMinYIndex + 1

    const isOnSameEdge =
      (Math.abs(this.A.x - this.bounds.minX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.minX) < 0.001) || // both on left
      (Math.abs(this.A.x - this.bounds.maxX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.maxX) < 0.001) || // both on right
      (Math.abs(this.A.y - this.bounds.minY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.minY) < 0.001) || // both on bottom
      (Math.abs(this.A.y - this.bounds.maxY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.maxY) < 0.001) // both on top

    if (
      this.futureConnections &&
      this.futureConnections.length === 0 &&
      this.obstacleRoutes.length === 0 &&
      !isOnSameEdge
    ) {
      this.handleSimpleCases()
    }

    const initialNodePosition = {
      x: Math.round(opts.A.x / (this.cellStep / 2)) * (this.cellStep / 2),
      y: Math.round(opts.A.y / (this.cellStep / 2)) * (this.cellStep / 2),
    }
    this.initialNodeGridOffset = {
      x:
        initialNodePosition.x -
        Math.round(opts.A.x / this.cellStep) * this.cellStep,
      y:
        initialNodePosition.y -
        Math.round(opts.A.y / this.cellStep) * this.cellStep,
    }
    const initialParent = {
      ...opts.A,
      z: opts.A.z ?? 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const roundedInitialNode = {
      ...opts.A,
      ...initialNodePosition,
      z: opts.A.z ?? 0,
      g: 0,
      h: 0,
      f: 0,
      parent: initialParent,
    }
    const roundedInitialNodeDiffersFromA =
      Math.abs(roundedInitialNode.x - opts.A.x) > 1e-9 ||
      Math.abs(roundedInitialNode.y - opts.A.y) > 1e-9
    const shouldFallbackToExactStart =
      roundedInitialNodeDiffersFromA &&
      (this.isNodeTooCloseToObstacle(roundedInitialNode) ||
        this.isNodeTooCloseToEdge(roundedInitialNode, false) ||
        this.doesPathToParentIntersectObstacle(roundedInitialNode))

    this.candidates = new SingleRouteCandidatePriorityQueue([
      shouldFallbackToExactStart ? initialParent : roundedInitialNode,
    ])
  }

  handleSimpleCases() {
    this.solved = true
    const { A, B } = this
    const route =
      A.z === B.z
        ? [A, B]
        : [
            A,
            { ...this.boundsCenter, z: this.A.z },
            {
              ...this.boundsCenter,
              z: B.z,
            },
            B,
          ]
    this.solvedPath = {
      connectionName: this.connectionName,
      rootConnectionName: this.rootConnectionName,
      regionId: this.regionId,
      route,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: this.A.z === this.B.z ? [] : [this.boundsCenter],
    }
  }

  get viaPenaltyDistance() {
    return this.cellStep + this.straightLineDistance * this.VIA_PENALTY_FACTOR
  }

  isNodeTooCloseToObstacle(
    node: Node,
    margin?: number,
    isVia?: boolean,
    planarObstacleQuery?: PlanarObstacleQuery,
  ) {
    margin ??= this.obstacleMargin

    if (isVia && node.parent) {
      const viasInMyRoute = this.getViasInNodePath(node.parent)
      for (const via of viasInMyRoute) {
        if (distance(node, via) < this.viaDiameter / 2 + margin) {
          return true
        }
      }
    }

    const traceProximity = this.traceThickness + margin
    const viaProximity = this.viaDiameter / 2 + this.traceThickness / 2 + margin
    // Planar point clearance is independent of the parent. Supplied queries
    // must cover the full point rectangle before their result can be reused.
    const canCachePlanarPoint =
      !isVia &&
      this.gridWidth !== undefined &&
      (!planarObstacleQuery ||
        planarObstacleQuery.pointQueryProximity === traceProximity) &&
      (this.obstacleViaIndex !== null ||
        this.obstacleSegmentIndexByLayer.has(node.z))
    const pointKey = canCachePlanarPoint
      ? (planarObstacleQuery?.pointKey ?? this.getNodeKey(node))
      : undefined
    if (pointKey !== undefined) {
      if (
        this.cachedPlanarTraceProximity !== traceProximity ||
        this.cachedPlanarViaProximity !== viaProximity
      ) {
        this.freePlanarObstaclePoints.clear()
        this.cachedPlanarTraceProximity = traceProximity
        this.cachedPlanarViaProximity = viaProximity
      }
      const freePoint = this.freePlanarObstaclePoints.get(pointKey)
      // A rounded grid key can represent different floating-point coordinates.
      if (
        freePoint &&
        freePoint.x === node.x &&
        freePoint.y === node.y &&
        freePoint.z === node.z
      ) {
        return false
      }
    }
    const indexedSegments =
      planarObstacleQuery?.segments ??
      (!isVia
        ? this.obstacleSegmentsByLayer.get(node.z)
        : this.obstacleSegments)
    const nearbySegmentIds =
      planarObstacleQuery?.segmentIds ??
      (!isVia
        ? this.obstacleSegmentIndexByLayer.get(node.z)
        : this.obstacleSegmentIndex
      )?.search(
        node.x - traceProximity,
        node.y - traceProximity,
        node.x + traceProximity,
        node.y + traceProximity,
      ) ??
      []
    const queryBounds = planarObstacleQuery?.segmentBounds
    if (indexedSegments) {
      for (const segmentId of nearbySegmentIds) {
        const segment = indexedSegments[segmentId]
        if (!segment || segment.connectedToCurrentConnection) continue
        if (!isVia && segment.z !== node.z) continue
        if (
          queryBounds &&
          (queryBounds.maxX < segment.minX ||
            queryBounds.maxY < segment.minY ||
            queryBounds.minX > segment.maxX ||
            queryBounds.minY > segment.maxY)
        ) {
          continue
        }
        if (
          planarObstacleQuery &&
          (node.x + traceProximity < segment.minX ||
            node.y + traceProximity < segment.minY ||
            node.x - traceProximity > segment.maxX ||
            node.y - traceProximity > segment.maxY)
        ) {
          continue
        }
        if (
          Math.sqrt(
            getPointToPrecomputedSegmentDistanceSquared(
              node,
              segment.A,
              segment.deltaX,
              segment.deltaY,
              segment.lengthSquared,
            ),
          ) < traceProximity
        ) {
          return true
        }
      }
    }

    if (this.obstacleViaIndex) {
      const nearbyViaIds = this.obstacleViaIndex.search(
        node.x - viaProximity,
        node.y - viaProximity,
        node.x + viaProximity,
        node.y + viaProximity,
      )
      for (const viaId of nearbyViaIds) {
        const via = this.obstacleVias[viaId]
        if (via && distance(node, via) < viaProximity) {
          return true
        }
      }
    }

    if (pointKey !== undefined) {
      this.freePlanarObstaclePoints.set(pointKey, {
        x: node.x,
        y: node.y,
        z: node.z,
      })
    }
    return false
  }

  isNodeTooCloseToEdge(node: Node, isVia?: boolean) {
    const margin = isVia
      ? this.viaDiameter / 2 + this.obstacleMargin / 2
      : this.obstacleMargin / 2
    const tooClose =
      node.x < this.bounds.minX + margin ||
      node.x > this.bounds.maxX - margin ||
      node.y < this.bounds.minY + margin ||
      node.y > this.bounds.maxY - margin
    if (tooClose && !isVia) {
      // If it's close to B or A it's an exception
      if (
        distance(node, this.B) < margin * 2 ||
        distance(node, this.A) < margin * 2
      ) {
        return false
      }
    }
    return tooClose
  }

  doesPathToParentIntersectObstacle(
    node: Node,
    planarObstacleQuery?: PlanarObstacleQuery,
  ) {
    const parent = node.parent
    if (!parent) return false
    const indexedSegments =
      planarObstacleQuery?.segments ?? this.obstacleSegmentsByLayer.get(node.z)
    if (!indexedSegments) return false

    const clearance =
      node.z === parent.z && this.obstacleSegments.length > 0
        ? this.NEARBY_SEGMENT_CLEARANCE
        : 0

    const minX = Math.min(node.x, parent.x)
    const maxX = Math.max(node.x, parent.x)
    const minY = Math.min(node.y, parent.y)
    const maxY = Math.max(node.y, parent.y)

    const nearbySegmentIds =
      planarObstacleQuery?.segmentIds ??
      this.obstacleSegmentIndexByLayer
        .get(node.z)
        ?.search(
          minX - clearance,
          minY - clearance,
          maxX + clearance,
          maxY + clearance,
        ) ??
      []
    const queryBounds = planarObstacleQuery?.segmentBounds
    const pathDeltaX = parent.x - node.x
    const pathDeltaY = parent.y - node.y
    const pathLengthSquared = pathDeltaX ** 2 + pathDeltaY ** 2

    for (const segmentId of nearbySegmentIds) {
      const segment = indexedSegments[segmentId]
      if (!segment || segment.connectedToCurrentConnection) continue
      if (segment.z !== node.z) continue
      if (
        queryBounds &&
        (queryBounds.maxX < segment.minX ||
          queryBounds.maxY < segment.minY ||
          queryBounds.minX > segment.maxX ||
          queryBounds.minY > segment.maxY)
      ) {
        continue
      }
      if (
        planarObstacleQuery &&
        (maxX + clearance < segment.minX ||
          maxY + clearance < segment.minY ||
          minX - clearance > segment.maxX ||
          minY - clearance > segment.maxY)
      ) {
        continue
      }
      // TODO: find out why removing doSegmentsIntersect is causing more intersections
      if (doSegmentsIntersect(node, parent, segment.A, segment.B)) {
        return true
      }
      if (
        clearance > 0 &&
        getSegmentToSegmentCenterlineDistance(
          node,
          parent,
          pathDeltaX,
          pathDeltaY,
          pathLengthSquared,
          segment,
        ) < clearance
      ) {
        return true
      }
    }
    return false
  }

  getPlanarObstacleQuery(
    node: Node,
    sharedQuery?: PlanarObstacleQuery,
    pointKey?: number,
  ): PlanarObstacleQuery | undefined {
    const parent = node.parent
    if (!parent) return undefined
    const segmentIndex = sharedQuery
      ? undefined
      : this.obstacleSegmentIndexByLayer.get(node.z)
    const segments =
      sharedQuery?.segments ?? this.obstacleSegmentsByLayer.get(node.z)
    if (!segments || (!sharedQuery && !segmentIndex)) return undefined

    const traceProximity = this.traceThickness + this.obstacleMargin
    const clearance =
      node.z === parent.z && this.obstacleSegments.length > 0
        ? this.NEARBY_SEGMENT_CLEARANCE
        : 0

    const minX = Math.min(node.x - traceProximity, parent.x - clearance)
    const minY = Math.min(node.y - traceProximity, parent.y - clearance)
    const maxX = Math.max(node.x + traceProximity, parent.x + clearance)
    const maxY = Math.max(node.y + traceProximity, parent.y + clearance)
    if (sharedQuery) {
      const queryBounds = (sharedQuery.segmentBounds ??= {
        minX,
        minY,
        maxX,
        maxY,
      })
      queryBounds.minX = minX
      queryBounds.minY = minY
      queryBounds.maxX = maxX
      queryBounds.maxY = maxY
      sharedQuery.pointQueryProximity = traceProximity
      sharedQuery.pointKey = pointKey
      return sharedQuery
    }
    return {
      segments,
      segmentIds: segmentIndex!.search(minX, minY, maxX, maxY),
      pointQueryProximity: traceProximity,
      pointKey,
    }
  }

  getPlanarNeighborObstacleQuery(node: Node): PlanarObstacleQuery | undefined {
    const segmentIndex = this.obstacleSegmentIndexByLayer.get(node.z)
    const segments = this.obstacleSegmentsByLayer.get(node.z)
    if (!segmentIndex || !segments) return undefined
    const traceProximity = this.traceThickness + this.obstacleMargin
    const clearance =
      this.obstacleSegments.length > 0 ? this.NEARBY_SEGMENT_CLEARANCE : 0
    const { minX, minY, maxX, maxY } = this.bounds
    const minimumNeighborX = clamp(node.x - this.cellStep, minX, maxX)
    const minimumNeighborY = clamp(node.y - this.cellStep, minY, maxY)
    const maximumNeighborX = clamp(node.x + this.cellStep, minX, maxX)
    const maximumNeighborY = clamp(node.y + this.cellStep, minY, maxY)
    return {
      segments,
      segmentIds: segmentIndex.search(
        Math.min(minimumNeighborX - traceProximity, node.x - clearance),
        Math.min(minimumNeighborY - traceProximity, node.y - clearance),
        Math.max(maximumNeighborX + traceProximity, node.x + clearance),
        Math.max(maximumNeighborY + traceProximity, node.y + clearance),
      ),
    }
  }

  buildObstacleIndexes() {
    this.freePlanarObstaclePoints.clear()
    if (this.obstacleRoutes.length === 0) {
      this.obstacleSegmentIndex = null
      this.obstacleSegmentsByLayer.clear()
      this.obstacleSegmentIndexByLayer.clear()
      this.obstacleViaIndex = null
      return
    }

    const obstacleSegments: IndexedObstacleSegment[] = []
    const obstacleVias: IndexedObstacleVia[] = []

    for (const route of this.obstacleRoutes) {
      const connectedToCurrentConnection =
        this.connMap?.areIdsConnected?.(
          this.connectionName,
          route.connectionName,
        ) ?? false

      for (const pointPair of getSameLayerPointPairs(route)) {
        const deltaX = pointPair.B.x - pointPair.A.x
        const deltaY = pointPair.B.y - pointPair.A.y
        obstacleSegments.push({
          ...pointPair,
          deltaX,
          deltaY,
          lengthSquared: deltaX ** 2 + deltaY ** 2,
          minX: Math.min(pointPair.A.x, pointPair.B.x),
          minY: Math.min(pointPair.A.y, pointPair.B.y),
          maxX: Math.max(pointPair.A.x, pointPair.B.x),
          maxY: Math.max(pointPair.A.y, pointPair.B.y),
          connectedToCurrentConnection,
        })
      }

      for (const via of route.vias) {
        obstacleVias.push(via)
      }
    }

    this.obstacleSegments = obstacleSegments
    this.obstacleVias = obstacleVias
    this.obstacleSegmentsByLayer.clear()
    this.obstacleSegmentIndexByLayer.clear()

    if (obstacleSegments.length > 0) {
      const segmentIndex = new Flatbush(obstacleSegments.length)
      for (const segment of obstacleSegments) {
        segmentIndex.add(segment.minX, segment.minY, segment.maxX, segment.maxY)
      }
      segmentIndex.finish()
      this.obstacleSegmentIndex = segmentIndex

      for (const segment of obstacleSegments) {
        if (segment.connectedToCurrentConnection) continue
        const segmentsForLayer = this.obstacleSegmentsByLayer.get(segment.z)
        if (segmentsForLayer) {
          segmentsForLayer.push(segment)
        } else {
          this.obstacleSegmentsByLayer.set(segment.z, [segment])
        }
      }
      for (const [z, segmentsForLayer] of this.obstacleSegmentsByLayer) {
        const layerIndex = new Flatbush(segmentsForLayer.length)
        for (const segment of segmentsForLayer) {
          layerIndex.add(segment.minX, segment.minY, segment.maxX, segment.maxY)
        }
        layerIndex.finish()
        this.obstacleSegmentIndexByLayer.set(z, layerIndex)
      }
    } else {
      this.obstacleSegmentIndex = null
    }

    if (obstacleVias.length > 0) {
      const viaIndex = new Flatbush(obstacleVias.length)
      for (const via of obstacleVias) {
        viaIndex.add(via.x, via.y, via.x, via.y)
      }
      viaIndex.finish()
      this.obstacleViaIndex = viaIndex
    } else {
      this.obstacleViaIndex = null
    }
  }

  computeH(node: Node) {
    return (
      distance(node, this.B) +
      // via penalty (one via can reach any layer, so just check if layers differ)
      (node.z !== this.B.z ? this.viaPenaltyDistance : 0)
    )
  }

  computeG(node: Node) {
    return (
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      distance(node, node.parent!)
    )
  }

  computeF(g: number, h: number) {
    return g + h * this.GREEDY_MULTIPLER
  }

  setNodeCosts(node: Node) {
    node.g = this.computeG(node)
    node.h = this.computeH(node)
    node.f = this.computeF(node.g, node.h)
  }

  getNodeKey(node: Node) {
    const xIndex = Math.round(node.x / this.cellStep) - this.gridMinXIndex
    const yIndex = Math.round(node.y / this.cellStep) - this.gridMinYIndex
    return (node.z * this.gridHeight + yIndex) * this.gridWidth + xIndex
  }

  getNeighbors(node: Node) {
    const neighbors: Node[] = []
    let unexposedNeighbor: Node | undefined
    const nodeKeyArguments: [Node | undefined] = [undefined]
    let sharedPlanarObstacleQuery: PlanarObstacleQuery | undefined
    let queriedPlanarNeighbors = false

    const { maxX, minX, maxY, minY } = this.bounds

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue

        let neighbor: Node
        if (unexposedNeighbor) {
          neighbor = unexposedNeighbor
          neighbor.x = clamp(node.x + x * this.cellStep, minX, maxX)
          neighbor.y = clamp(node.y + y * this.cellStep, minY, maxY)
          neighbor.z = node.z
          neighbor.g = node.g
          neighbor.h = node.h
          neighbor.f = node.f
          neighbor.parent = node
        } else {
          neighbor = {
            x: clamp(node.x + x * this.cellStep, minX, maxX),
            y: clamp(node.y + y * this.cellStep, minY, maxY),
            z: node.z,
            g: node.g,
            h: node.h,
            f: node.f,
            parent: node,
          }
        }

        // The native key method only reads this record. Custom methods and all
        // later hooks receive ownership, so their node references stay distinct.
        const getNodeKey = this.getNodeKey
        const canReuseNeighbor = getNodeKey === nativeGetNodeKey
        unexposedNeighbor = undefined
        nodeKeyArguments[0] = neighbor
        const neighborKey = applyNodeKey(getNodeKey, this, nodeKeyArguments)

        if (this.exploredNodes.has(neighborKey)) {
          if (canReuseNeighbor) unexposedNeighbor = neighbor
          continue
        }

        if (!queriedPlanarNeighbors) {
          sharedPlanarObstacleQuery = this.getPlanarNeighborObstacleQuery(node)
          queriedPlanarNeighbors = true
        }
        const planarObstacleQuery = this.getPlanarObstacleQuery(
          neighbor,
          sharedPlanarObstacleQuery,
          neighborKey,
        )
        if (
          this.isNodeTooCloseToObstacle(
            neighbor,
            undefined,
            false,
            planarObstacleQuery,
          )
        ) {
          if (this.debugEnabled) {
            this.debug_nodesTooCloseToObstacle.add(neighborKey)
          }
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.isNodeTooCloseToEdge(neighbor, false)) {
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (
          this.doesPathToParentIntersectObstacle(neighbor, planarObstacleQuery)
        ) {
          if (this.debugEnabled) {
            this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          }
          this.exploredNodes.add(neighborKey)
          continue
        }

        this.setNodeCosts(neighbor)

        neighbors.push(neighbor)
      }
    }

    // Add via neighbors for all other layers (a via can connect any layer to any other layer)
    for (const newZ of this.availableZ) {
      if (newZ === node.z) continue

      const viaNeighbor: Node = {
        x: node.x,
        y: node.y,
        z: newZ,
        g: node.g,
        h: node.h,
        f: node.f,
        parent: node,
      }

      if (
        !this.exploredNodes.has(this.getNodeKey(viaNeighbor)) &&
        !this.isNodeTooCloseToObstacle(
          viaNeighbor,
          this.viaDiameter / 2 + this.obstacleMargin / 2,
          true,
        ) &&
        !this.isNodeTooCloseToEdge(viaNeighbor, true)
      ) {
        this.setNodeCosts(viaNeighbor)

        neighbors.push(viaNeighbor)
      }
    }

    return neighbors
  }

  getNodePath(node: Node) {
    const path: Node[] = []
    while (node) {
      path.push(node)
      node = node.parent!
    }
    return path
  }

  getViasInNodePath(node: Node): { x: number; y: number }[] {
    const cachedVias = this.viasInPathByNode.get(node)
    if (cachedVias) return cachedVias

    const parent = node.parent
    const parentVias: { x: number; y: number }[] = parent
      ? this.getViasInNodePath(parent)
      : []
    const vias: { x: number; y: number }[] =
      parent && node.z !== parent.z
        ? [{ x: node.x, y: node.y }, ...parentVias]
        : parentVias
    this.viasInPathByNode.set(node, vias)
    return vias
  }

  setSolvedPath(node: Node) {
    const path = this.getNodePath(node)
    path.reverse()

    const vias: { x: number; y: number }[] = []
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].z !== path[i + 1].z) {
        vias.push({ x: path[i].x, y: path[i].y })
      }
    }

    this.solvedPath = {
      connectionName: this.connectionName,
      rootConnectionName: this.rootConnectionName,
      regionId: this.regionId,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      route: path
        .map((node) => ({ x: node.x, y: node.y, z: node.z }))
        .concat([this.B]),
      vias,
    }
  }

  computeProgress(currentNode?: Node, goalDist?: number, isOnLayer?: boolean) {
    // BaseSolver probes computeProgress() without arguments after every step.
    // Preserve the legacy NaN result without repeating the trigonometry.
    if (goalDist === undefined || isOnLayer === undefined) return Number.NaN
    if (!isOnLayer) goalDist += this.viaPenaltyDistance
    const goalDistPercent = 1 - goalDist / this.straightLineDistance

    // This is a perfectly acceptable progress metric
    // return Math.max(this.progress || 0, goalDistPercent)

    // Linearize because it typically gets harder towards the end
    return Math.max(
      this.progress || 0,
      // 0.112 = ~90% -> 50%
      //         ~25% -> 2%
      //         ~99% -> 94%
      //         ~95% -> 72%
      (2 / Math.PI) *
        Math.atan((0.112 * goalDistPercent) / (1 - goalDistPercent)),
    )
  }

  _step() {
    let currentNode = this.candidates.dequeue()
    let currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined

    while (
      currentNode &&
      currentNodeKey &&
      this.exploredNodes.has(currentNodeKey)
    ) {
      currentNode = this.candidates.dequeue()
      currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
    }

    if (!currentNode || !currentNodeKey) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    this.exploredNodes.add(currentNodeKey)
    if (this.debugEnabled) {
      this.debug_exploredNodesOrdered.push({
        key: currentNodeKey,
        x:
          Math.round(currentNode.x / this.cellStep) * this.cellStep +
          this.initialNodeGridOffset.x,
        y:
          Math.round(currentNode.y / this.cellStep) * this.cellStep +
          this.initialNodeGridOffset.y,
        z: currentNode.z,
      })
    }

    const goalDist = distance(currentNode, this.B)

    this.progress = this.computeProgress(
      currentNode,
      goalDist,
      currentNode.z === this.B.z,
    )

    if (
      goalDist <= this.cellStep * Math.SQRT2 &&
      currentNode.z === this.B.z &&
      // Make sure the last segment doesn't intersect an obstacle
      !this.doesPathToParentIntersectObstacle({
        ...currentNode,
        parent: currentNode,
        x: this.B.x,
        y: this.B.y,
      })
    ) {
      this.solved = true
      this.setSolvedPath(currentNode)
    }

    const neighbors = this.getNeighbors(currentNode)
    for (const neighbor of neighbors) {
      this.candidates.enqueue(neighbor)
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Display the input port points (from nodeWithPortPoints via A and B)
    graphics.points!.push({
      x: this.A.x,
      y: this.A.y,
      label: connectionLabel(this.connectionName, this.rootConnectionName, [
        "Input A",
        `z: ${this.A.z}`,
      ]),
      color: "orange",
    })
    graphics.points!.push({
      x: this.B.x,
      y: this.B.y,
      label: connectionLabel(this.connectionName, this.rootConnectionName, [
        "Input B",
        `z: ${this.B.z}`,
      ]),
      color: "orange",
    })

    // Draw circles at future connection points
    // if ("FUTURE_CONNECTION_PROXIMITY_VD" in this) {
    //   for (const futureConnection of this.futureConnections) {
    //     for (const point of futureConnection.points) {
    //       graphics.circles!.push({
    //         center: point,
    //         radius:
    //           (this.viaDiameter *
    //             (this.FUTURE_CONNECTION_PROXIMITY_VD as number)) /
    //           2,
    //         // strokeColor: "rgba(0, 255, 0, 0.3)",
    //         stroke: "rgba(0,255,0,0.1)",
    //         label: `Future Connection: ${futureConnection.connectionName}`,
    //       })
    //     }
    //   }
    //   // Draw circles around obstacle route points
    //   for (const route of this.obstacleRoutes) {
    //     for (const point of [
    //       route.route[0],
    //       route.route[route.route.length - 1],
    //     ]) {
    //       graphics.circles!.push({
    //         center: point,
    //         radius:
    //           (this.viaDiameter *
    //             (this.FUTURE_CONNECTION_PROXIMITY_VD as number)) /
    //           2,
    //         stroke: "rgba(255,0,0,0.1)",
    //         label: "Obstacle Route Point",
    //       })
    //     }
    //   }
    // }

    // Draw a line representing the direct connection between the input port points
    graphics.lines!.push({
      points: [this.A, this.B],
      strokeColor: "rgba(255, 0, 0, 0.5)",
      label: connectionLabel(this.connectionName, this.rootConnectionName, [
        "Direct Input Connection",
      ]),
    })

    // Show any obstacle routes as background references
    for (
      let routeIndex = 0;
      routeIndex < this.obstacleRoutes.length;
      routeIndex++
    ) {
      const route = this.obstacleRoutes[routeIndex]
      for (let i = 0; i < route.route.length - 1; i++) {
        const z = route.route[i].z
        graphics.lines!.push({
          points: [route.route[i], route.route[i + 1]],
          strokeColor:
            z === 0 ? "rgba(255, 0, 0, 0.75)" : "rgba(255, 128, 0, 0.25)",
          strokeWidth: route.traceThickness,
          label: connectionLabel(
            route.connectionName,
            route.rootConnectionName,
            ["Obstacle Route"],
          ),
          layer: `obstacle${routeIndex.toString()}`,
        })
      }
    }

    // Optionally, visualize explored nodes for debugging purposes
    for (let i = 0; i < this.debug_exploredNodesOrdered.length; i++) {
      const { key: nodeKey, x, y, z } = this.debug_exploredNodesOrdered[i]
      if (this.debug_nodesTooCloseToObstacle.has(nodeKey)) continue
      if (this.debug_nodePathToParentIntersectsObstacle.has(nodeKey)) continue
      graphics.rects!.push({
        center: {
          x: x + (z * this.cellStep) / 20,
          y: y + (z * this.cellStep) / 20,
        },
        fill:
          z === 0
            ? `rgba(255,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`
            : `rgba(0,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`,
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: `Explored (z=${z})`,
      })
    }

    // Visualize the next node to be explored
    if (this.candidates.peek()) {
      const nextNode = this.candidates.peek()!
      graphics.rects!.push({
        center: {
          x: nextNode.x + (nextNode.z * this.cellStep) / 20,
          y: nextNode.y + (nextNode.z * this.cellStep) / 20,
        },
        fill: "rgba(0, 255, 0, 0.8)",
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: `Next (z=${nextNode.z})`,
      })
    }

    // Visualize vias from obstacle routes
    for (const route of this.obstacleRoutes) {
      for (const via of route.vias) {
        graphics.circles!.push({
          center: {
            x: via.x,
            y: via.y,
          },
          radius: this.viaDiameter / 2,
          fill: "rgba(255, 0, 0, 0.5)",
          label: "Via",
        })
      }
    }
    // If a solved route exists, display it along with via markers
    if (this.solvedPath) {
      graphics.lines!.push({
        points: this.solvedPath.route,
        strokeColor: "green",
        label: connectionLabel(
          this.solvedPath.connectionName,
          this.solvedPath.rootConnectionName,
          ["Solved Route"],
        ),
      })
      for (const via of this.solvedPath.vias) {
        graphics.circles!.push({
          center: via,
          radius: this.viaDiameter / 2,
          fill: "green",
          label: connectionLabel(
            this.solvedPath.connectionName,
            this.solvedPath.rootConnectionName,
            ["Via"],
          ),
        })
      }
    }

    return graphics
  }
}

type IndexedObstacleSegment = {
  z: number
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
  deltaX: number
  deltaY: number
  lengthSquared: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  connectedToCurrentConnection: boolean
}

type IndexedObstacleVia = { x: number; y: number }

type FreePlanarObstaclePoint = {
  x: number
  y: number
  z: number
}

type PlanarObstacleQuery = {
  segments: IndexedObstacleSegment[]
  segmentIds: number[]
  segmentBounds?: { minX: number; minY: number; maxX: number; maxY: number }
  pointQueryProximity?: number
  pointKey?: number
}

function getSameLayerPointPairs(route: HighDensityIntraNodeRoute) {
  const pointPairs: {
    z: number
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
  }[] = []

  for (let i = 0; i < route.route.length - 1; i++) {
    if (route.route[i].z === route.route[i + 1].z) {
      pointPairs.push({
        z: route.route[i].z,
        A: route.route[i],
        B: route.route[i + 1],
      })
    }
  }

  return pointPairs
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function getSegmentToSegmentCenterlineDistance(
  leftA: { x: number; y: number },
  leftB: { x: number; y: number },
  leftDeltaX: number,
  leftDeltaY: number,
  leftLengthSquared: number,
  right: IndexedObstacleSegment,
): number {
  // Keep the square root before the strict clearance comparison: squaring the
  // threshold would change rounding at the original distance boundary.
  return Math.sqrt(
    Math.min(
      getPointToPrecomputedSegmentDistanceSquared(
        leftA,
        right.A,
        right.deltaX,
        right.deltaY,
        right.lengthSquared,
      ),
      getPointToPrecomputedSegmentDistanceSquared(
        leftB,
        right.A,
        right.deltaX,
        right.deltaY,
        right.lengthSquared,
      ),
      getPointToPrecomputedSegmentDistanceSquared(
        right.A,
        leftA,
        leftDeltaX,
        leftDeltaY,
        leftLengthSquared,
      ),
      getPointToPrecomputedSegmentDistanceSquared(
        right.B,
        leftA,
        leftDeltaX,
        leftDeltaY,
        leftLengthSquared,
      ),
    ),
  )
}

function getPointToPrecomputedSegmentDistanceSquared(
  point: { x: number; y: number },
  start: { x: number; y: number },
  deltaX: number,
  deltaY: number,
  lengthSquared: number,
): number {
  if (lengthSquared === 0) {
    const dx = point.x - start.x
    const dy = point.y - start.y
    return dx * dx + dy * dy
  }
  const projectionRatio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  )
  const projectionX = start.x + projectionRatio * deltaX
  const projectionY = start.y + projectionRatio * deltaY
  const dx = point.x - projectionX
  const dy = point.y - projectionY
  return dx * dx + dy * dy
}

const nativeGetNodeKey = SingleHighDensityRouteSolver.prototype.getNodeKey
const applyNodeKey = Reflect.apply
