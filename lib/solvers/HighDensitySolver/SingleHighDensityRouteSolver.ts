import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
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

type SharedPlanarViaQuery = {
  index: Flatbush
  minX: number
  minY: number
  maxX: number
  maxY: number
  proximity: number
  viaIds?: number[]
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

  exploredNodes!: Set<number>
  private exploredNodeBitmap: Uint8Array | null | undefined
  private exploredNodeOrder: number[] = []
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
  private sharedPlanarViaQueries = new WeakMap<
    PlanarObstacleQuery,
    SharedPlanarViaQuery
  >()

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
    // Internal searches need membership, while public callers need a mutable
    // native Set. Materialize that Set only when its public property is read.
    Object.defineProperty(this, "exploredNodes", {
      configurable: true,
      enumerable: true,
      get: this.materializeExploredNodes,
      set: this.replaceExploredNodes,
    })
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
    if (indexedSegments) {
      for (const segmentId of nearbySegmentIds) {
        const segment = indexedSegments[segmentId]
        if (!segment || segment.connectedToCurrentConnection) continue
        if (!isVia && segment.z !== node.z) continue
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
          pointToSegmentDistance(node, segment.A, segment.B) < traceProximity
        ) {
          return true
        }
      }
    }

    const viaProximity = this.viaDiameter / 2 + this.traceThickness / 2 + margin
    if (this.obstacleViaIndex) {
      const minX = node.x - viaProximity
      const minY = node.y - viaProximity
      const maxX = node.x + viaProximity
      const maxY = node.y + viaProximity
      const sharedQuery =
        !isVia && planarObstacleQuery
          ? this.sharedPlanarViaQueries.get(planarObstacleQuery)
          : undefined
      const canShareViaQuery =
        sharedQuery &&
        sharedQuery.index === this.obstacleViaIndex &&
        sharedQuery.proximity === viaProximity &&
        sharedQuery.minX <= minX &&
        sharedQuery.minY <= minY &&
        sharedQuery.maxX >= maxX &&
        sharedQuery.maxY >= maxY
      // Defer the union query until a candidate survives segment clearance.
      // Its IDs live only as long as this expansion's planar query object.
      const nearbyViaIds = canShareViaQuery
        ? (sharedQuery.viaIds ??= this.obstacleViaIndex.search(
            sharedQuery.minX,
            sharedQuery.minY,
            sharedQuery.maxX,
            sharedQuery.maxY,
          ))
        : this.obstacleViaIndex.search(minX, minY, maxX, maxY)
      for (const viaId of nearbyViaIds) {
        const via = this.obstacleVias[viaId]
        if (
          canShareViaQuery &&
          via &&
          (maxX < via.x || maxY < via.y || minX > via.x || minY > via.y)
        )
          continue
        if (via && distance(node, via) < viaProximity) {
          return true
        }
      }
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

    for (const segmentId of nearbySegmentIds) {
      const segment = indexedSegments[segmentId]
      if (!segment || segment.connectedToCurrentConnection) continue
      if (segment.z !== node.z) continue
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
          segment.A,
          segment.B,
        ) < clearance
      ) {
        return true
      }
    }
    return false
  }

  getPlanarObstacleQuery(node: Node): PlanarObstacleQuery | undefined {
    const parent = node.parent
    if (!parent) return undefined
    const segmentIndex = this.obstacleSegmentIndexByLayer.get(node.z)
    const segments = this.obstacleSegmentsByLayer.get(node.z)
    if (!segmentIndex || !segments) return undefined

    const traceProximity = this.traceThickness + this.obstacleMargin
    const clearance =
      node.z === parent.z && this.obstacleSegments.length > 0
        ? this.NEARBY_SEGMENT_CLEARANCE
        : 0

    return {
      segments,
      segmentIds: segmentIndex.search(
        Math.min(node.x - traceProximity, parent.x - clearance),
        Math.min(node.y - traceProximity, parent.y - clearance),
        Math.max(node.x + traceProximity, parent.x + clearance),
        Math.max(node.y + traceProximity, parent.y + clearance),
      ),
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

    // All planar neighbors share a parent and layer. Query their combined
    // bounds once; the collision checks still filter each candidate's bounds.
    const query = {
      segments,
      segmentIds: segmentIndex.search(
        Math.min(
          clamp(node.x - this.cellStep, minX, maxX) - traceProximity,
          node.x - clearance,
        ),
        Math.min(
          clamp(node.y - this.cellStep, minY, maxY) - traceProximity,
          node.y - clearance,
        ),
        Math.max(
          clamp(node.x + this.cellStep, minX, maxX) + traceProximity,
          node.x + clearance,
        ),
        Math.max(
          clamp(node.y + this.cellStep, minY, maxY) + traceProximity,
          node.y + clearance,
        ),
      ),
    }
    if (this.obstacleViaIndex) {
      const proximity =
        this.viaDiameter / 2 + this.traceThickness / 2 + this.obstacleMargin
      this.sharedPlanarViaQueries.set(query, {
        index: this.obstacleViaIndex,
        minX: clamp(node.x - this.cellStep, minX, maxX) - proximity,
        minY: clamp(node.y - this.cellStep, minY, maxY) - proximity,
        maxX: clamp(node.x + this.cellStep, minX, maxX) + proximity,
        maxY: clamp(node.y + this.cellStep, minY, maxY) + proximity,
        proximity,
      })
    }
    return query
  }

  buildObstacleIndexes() {
    this.sharedPlanarViaQueries = new WeakMap()
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
        obstacleSegments.push({
          ...pointPair,
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

  private materializeExploredNodes(): Set<number> {
    if (this.exploredNodeBitmap === null) return this.exploredNodes
    const value = new Set(this.exploredNodeOrder)
    this.replaceExploredNodes(value)
    return value
  }

  private replaceExploredNodes(value: Set<number>): void {
    this.exploredNodeBitmap = null
    this.exploredNodeOrder = []
    Object.defineProperty(this, "exploredNodes", {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    })
  }

  private initializeExploredNodeBitmap(): void {
    const descriptor = Object.getOwnPropertyDescriptor(this, "exploredNodes")
    if (descriptor?.get !== this.materializeExploredNodes) {
      // A subclass can declare its own Set field after the base constructor.
      this.exploredNodeBitmap = null
      return
    }
    let maxZ = Math.max(this.layerCount - 1, this.A.z, this.B.z)
    for (const z of this.availableZ) maxZ = Math.max(maxZ, z)
    const cellCount = this.gridWidth * this.gridHeight * (maxZ + 1)
    if (
      this.getNodeKey === SingleHighDensityRouteSolver.prototype.getNodeKey &&
      Number.isSafeInteger(cellCount) &&
      cellCount > 0 &&
      cellCount <= 1_048_576
    ) {
      this.exploredNodeBitmap = new Uint8Array(cellCount)
    } else {
      this.materializeExploredNodes()
    }
  }

  private hasExploredNode(key: number): boolean {
    if (this.exploredNodeBitmap === undefined) {
      this.initializeExploredNodeBitmap()
    }
    const bitmap = this.exploredNodeBitmap
    if (!bitmap) return this.exploredNodes.has(key)
    if (Number.isInteger(key) && key >= 0 && key < bitmap.length) {
      return bitmap[key] === 1
    }
    return this.materializeExploredNodes().has(key)
  }

  private addExploredNode(key: number): void {
    if (this.exploredNodeBitmap === undefined) {
      this.initializeExploredNodeBitmap()
    }
    const bitmap = this.exploredNodeBitmap
    if (!bitmap) {
      this.exploredNodes.add(key)
      return
    }
    if (Number.isInteger(key) && key >= 0 && key < bitmap.length) {
      if (bitmap[key] === 0) {
        bitmap[key] = 1
        this.exploredNodeOrder.push(key === 0 ? 0 : key)
      }
      return
    }
    this.materializeExploredNodes().add(key)
  }

  getNodeKey(node: Node) {
    const xIndex = Math.round(node.x / this.cellStep) - this.gridMinXIndex
    const yIndex = Math.round(node.y / this.cellStep) - this.gridMinYIndex
    return (node.z * this.gridHeight + yIndex) * this.gridWidth + xIndex
  }

  getNeighbors(node: Node) {
    const neighbors: Node[] = []
    let planarObstacleQuery: PlanarObstacleQuery | undefined
    const canSharePlanarObstacleQuery =
      this.getPlanarObstacleQuery ===
        SingleHighDensityRouteSolver.prototype.getPlanarObstacleQuery &&
      this.NEARBY_SEGMENT_CLEARANCE <= this.traceThickness + this.obstacleMargin
    const canComputeCoordinateKey =
      this.getNodeKey === SingleHighDensityRouteSolver.prototype.getNodeKey

    const { maxX, minX, maxY, minY } = this.bounds

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue

        const neighborX = clamp(node.x + x * this.cellStep, minX, maxX)
        const neighborY = clamp(node.y + y * this.cellStep, minY, maxY)
        let neighbor: Node | undefined
        if (!canComputeCoordinateKey) {
          neighbor = {
            x: neighborX,
            y: neighborY,
            z: node.z,
            g: node.g,
            h: node.h,
            f: node.f,
            parent: node,
          }
        }
        const neighborKey = neighbor
          ? this.getNodeKey(neighbor)
          : (node.z * this.gridHeight +
              (Math.round(neighborY / this.cellStep) - this.gridMinYIndex)) *
              this.gridWidth +
            (Math.round(neighborX / this.cellStep) - this.gridMinXIndex)

        if (this.hasExploredNode(neighborKey)) {
          continue
        }
        neighbor ??= {
          x: neighborX,
          y: neighborY,
          z: node.z,
          g: node.g,
          h: node.h,
          f: node.f,
          parent: node,
        }

        if (canSharePlanarObstacleQuery) {
          planarObstacleQuery ??= this.getPlanarNeighborObstacleQuery(node)
        } else {
          planarObstacleQuery = this.getPlanarObstacleQuery(neighbor)
        }
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
          this.addExploredNode(neighborKey)
          continue
        }

        if (this.isNodeTooCloseToEdge(neighbor, false)) {
          this.addExploredNode(neighborKey)
          continue
        }

        if (
          this.doesPathToParentIntersectObstacle(neighbor, planarObstacleQuery)
        ) {
          if (this.debugEnabled) {
            this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          }
          this.addExploredNode(neighborKey)
          continue
        }

        this.setNodeCosts(neighbor)

        neighbors.push(neighbor)
      }
    }

    // Add via neighbors for all other layers (a via can connect any layer to any other layer)
    for (const newZ of this.availableZ) {
      if (newZ === node.z) continue

      let viaNeighbor: Node | undefined
      if (!canComputeCoordinateKey) {
        viaNeighbor = {
          x: node.x,
          y: node.y,
          z: newZ,
          g: node.g,
          h: node.h,
          f: node.f,
          parent: node,
        }
      }
      const viaKey = viaNeighbor
        ? this.getNodeKey(viaNeighbor)
        : (newZ * this.gridHeight +
            (Math.round(node.y / this.cellStep) - this.gridMinYIndex)) *
            this.gridWidth +
          (Math.round(node.x / this.cellStep) - this.gridMinXIndex)
      if (this.hasExploredNode(viaKey)) continue
      viaNeighbor ??= {
        x: node.x,
        y: node.y,
        z: newZ,
        g: node.g,
        h: node.h,
        f: node.f,
        parent: node,
      }

      if (
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
      this.hasExploredNode(currentNodeKey)
    ) {
      currentNode = this.candidates.dequeue()
      currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
    }

    if (!currentNode || !currentNodeKey) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    this.addExploredNode(currentNodeKey)
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
  minX: number
  minY: number
  maxX: number
  maxY: number
  connectedToCurrentConnection: boolean
}

type IndexedObstacleVia = { x: number; y: number }

type PlanarObstacleQuery = {
  segments: IndexedObstacleSegment[]
  segmentIds: number[]
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
  rightA: { x: number; y: number },
  rightB: { x: number; y: number },
) {
  return Math.min(
    pointToSegmentDistance(leftA, rightA, rightB),
    pointToSegmentDistance(leftB, rightA, rightB),
    pointToSegmentDistance(rightA, leftA, leftB),
    pointToSegmentDistance(rightB, leftA, leftB),
  )
}
