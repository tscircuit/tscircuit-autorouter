import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "@tscircuit/solver-utils"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  ConnectionPoint,
  Obstacle,
  SimpleRouteJson,
} from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export interface ApproximateHypergraphTopologySolverParams {
  simpleRouteJson: SimpleRouteJson
  targetCellSize?: number
  maxPortsPerLayerPerEdge?: number
  obstacleSamplingMargin?: number
  generatePortsAndEdges?: boolean
  localRefinementDepth?: number
}

export interface ApproximateHypergraphTopologyStats {
  columnCount: number
  rowCount: number
  regionCount: number
  edgeCount: number
  portCount: number
  rejectedPortCount: number
  targetCellSize: number
  maxPortsPerLayerPerEdge: number
  localRefinementDepth: number
  obstacleOccupiedRegionCount: number
  meanObstacleOccupancyFraction: number
  maxObstacleOccupancyFraction: number
}

export interface ApproximateHypergraphTopologyOutput {
  capacityMeshNodes: CapacityMeshNode[]
  capacityMeshEdges: CapacityMeshEdge[]
  sharedEdgeSegments: SharedEdgeSegment[]
  stats: ApproximateHypergraphTopologyStats
}

type GridDimensions = {
  columnCount: number
  rowCount: number
  cellWidth: number
  cellHeight: number
}

type SharedBoundary = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

type Point = { x: number; y: number }

type PreparedObstacleGeometry = {
  polygon: Point[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  zLayers: number[]
}

type PolygonClipBoundary = {
  axis: "x" | "y"
  value: number
  keepGreater: boolean
}

const DEFAULT_TARGET_CELL_SIZE = 6
const DEFAULT_MAX_PORTS_PER_LAYER_PER_EDGE = 6
const DEFAULT_CONGESTION_REFINEMENT_THRESHOLD = 6

const getObstaclePolygon = (obstacle: Obstacle, margin: number): Point[] => {
  const halfWidth = obstacle.width / 2 + margin
  const halfHeight = obstacle.height / 2 + margin
  const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: obstacle.center.x + point.x * cos - point.y * sin,
    y: obstacle.center.y + point.x * sin + point.y * cos,
  }))
}

const clipPolygonToBoundary = (
  polygon: Point[],
  boundary: PolygonClipBoundary,
): Point[] => {
  if (polygon.length === 0) return []
  const output: Point[] = []
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const previous = polygon[(index + polygon.length - 1) % polygon.length]!
    const currentCoordinate = current[boundary.axis]
    const previousCoordinate = previous[boundary.axis]
    const currentInside = boundary.keepGreater
      ? currentCoordinate >= boundary.value
      : currentCoordinate <= boundary.value
    const previousInside = boundary.keepGreater
      ? previousCoordinate >= boundary.value
      : previousCoordinate <= boundary.value

    if (currentInside !== previousInside) {
      const fraction =
        (boundary.value - previousCoordinate) /
        (currentCoordinate - previousCoordinate)
      output.push({
        x:
          boundary.axis === "x"
            ? boundary.value
            : previous.x + (current.x - previous.x) * fraction,
        y:
          boundary.axis === "y"
            ? boundary.value
            : previous.y + (current.y - previous.y) * fraction,
      })
    }
    if (currentInside) output.push(current)
  }
  return output
}

const getPolygonArea = (polygon: Point[]): number => {
  let doubleArea = 0
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]!
    const next = polygon[(index + 1) % polygon.length]!
    doubleArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(doubleArea) / 2
}

const getObstacleIntersectionArea = (
  node: CapacityMeshNode,
  obstacle: PreparedObstacleGeometry,
): number => {
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  if (
    obstacle.bounds.maxX <= minX ||
    obstacle.bounds.minX >= maxX ||
    obstacle.bounds.maxY <= minY ||
    obstacle.bounds.minY >= maxY
  ) {
    return 0
  }

  let intersection = obstacle.polygon
  for (const boundary of [
    { axis: "x", value: minX, keepGreater: true },
    { axis: "x", value: maxX, keepGreater: false },
    { axis: "y", value: minY, keepGreater: true },
    { axis: "y", value: maxY, keepGreater: false },
  ] satisfies PolygonClipBoundary[]) {
    intersection = clipPolygonToBoundary(intersection, boundary)
  }
  return getPolygonArea(intersection)
}

const prepareObstacleGeometry = (params: {
  obstacles: Obstacle[]
  layerCount: number
  margin: number
}): PreparedObstacleGeometry[] => {
  return params.obstacles.map((obstacle) => {
    const polygon = getObstaclePolygon(obstacle, params.margin)
    const xCoordinates = polygon.map((point) => point.x)
    const yCoordinates = polygon.map((point) => point.y)
    return {
      polygon,
      bounds: {
        minX: Math.min(...xCoordinates),
        maxX: Math.max(...xCoordinates),
        minY: Math.min(...yCoordinates),
        maxY: Math.max(...yCoordinates),
      },
      zLayers: getObstacleZLayers(obstacle, params.layerCount),
    }
  })
}

const getObstacleOccupancyFraction = (params: {
  node: CapacityMeshNode
  obstacles: PreparedObstacleGeometry[]
}): number => {
  const nodeLayerArea =
    params.node.width * params.node.height * params.node.availableZ.length
  if (nodeLayerArea <= 0) return 0

  let occupiedLayerArea = 0
  for (const obstacle of params.obstacles) {
    const sharedLayerCount = params.node.availableZ.filter((z) =>
      obstacle.zLayers.includes(z),
    ).length
    if (sharedLayerCount === 0) continue
    occupiedLayerArea +=
      getObstacleIntersectionArea(params.node, obstacle) * sharedLayerCount
  }
  return Math.min(1, occupiedLayerArea / nodeLayerArea)
}

const pointIsInsideNode = (
  point: { x: number; y: number },
  node: CapacityMeshNode,
): boolean => {
  const halfWidth = node.width / 2
  const halfHeight = node.height / 2
  return (
    point.x >= node.center.x - halfWidth &&
    point.x <= node.center.x + halfWidth &&
    point.y >= node.center.y - halfHeight &&
    point.y <= node.center.y + halfHeight
  )
}

const segmentIntersectsNode = (
  segment: { start: Point; end: Point },
  node: CapacityMeshNode,
): boolean => {
  if (
    pointIsInsideNode(segment.start, node) ||
    pointIsInsideNode(segment.end, node)
  ) {
    return true
  }
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  const nodeEdges: Array<[Point, Point]> = [
    [{ x: minX, y: minY }, { x: maxX, y: minY }],
    [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
    [{ x: maxX, y: maxY }, { x: minX, y: maxY }],
    [{ x: minX, y: maxY }, { x: minX, y: minY }],
  ]
  return nodeEdges.some(([start, end]) =>
    doSegmentsIntersect(segment.start, segment.end, start, end),
  )
}

const obstacleOverlapsNode = (
  obstacle: Obstacle,
  node: CapacityMeshNode,
  margin = 0,
): boolean => {
  const obstacleHalfWidth = obstacle.width / 2
  const obstacleHalfHeight = obstacle.height / 2
  const nodeHalfWidth = node.width / 2
  const nodeHalfHeight = node.height / 2
  return (
    Math.abs(obstacle.center.x - node.center.x) <=
      obstacleHalfWidth + nodeHalfWidth + margin &&
    Math.abs(obstacle.center.y - node.center.y) <=
      obstacleHalfHeight + nodeHalfHeight + margin
  )
}

export const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  return [
    ...new Set(
      obstacle.layers
        .map((layerName) => mapLayerNameToZ(layerName, layerCount))
        .filter((z) => Number.isInteger(z) && z >= 0 && z < layerCount),
    ),
  ].sort((a, b) => a - b)
}

export const pointIsBlockedByObstacle = (params: {
  point: { x: number; y: number }
  z: number
  obstacles: Obstacle[]
  obstacleZLayers: Map<Obstacle, number[]>
  margin: number
}): boolean => {
  for (const obstacle of params.obstacles) {
    if (!params.obstacleZLayers.get(obstacle)?.includes(params.z)) continue

    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const dx = params.point.x - obstacle.center.x
    const dy = params.point.y - obstacle.center.y
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
    if (
      Math.abs(localX) <= obstacle.width / 2 + params.margin &&
      Math.abs(localY) <= obstacle.height / 2 + params.margin
    ) {
      return true
    }
  }
  return false
}

const getGridDimensions = (
  simpleRouteJson: SimpleRouteJson,
  targetCellSize: number,
): GridDimensions => {
  const boardWidth = simpleRouteJson.bounds.maxX - simpleRouteJson.bounds.minX
  const boardHeight = simpleRouteJson.bounds.maxY - simpleRouteJson.bounds.minY
  const columnCount = Math.max(1, Math.ceil(boardWidth / targetCellSize))
  const rowCount = Math.max(1, Math.ceil(boardHeight / targetCellSize))
  return {
    columnCount,
    rowCount,
    cellWidth: boardWidth / columnCount,
    cellHeight: boardHeight / rowCount,
  }
}

const getConnectionPoints = (
  simpleRouteJson: SimpleRouteJson,
): ConnectionPoint[] => {
  return simpleRouteJson.connections.flatMap(
    (connection) => connection.pointsToConnect,
  )
}

const getGridNodes = (params: {
  simpleRouteJson: SimpleRouteJson
  dimensions: GridDimensions
  localRefinementDepth: number
  refinementMargin: number
  obstacleGeometry: PreparedObstacleGeometry[]
}): CapacityMeshNode[] => {
  const { simpleRouteJson, dimensions } = params
  const allZ = Array.from(
    { length: simpleRouteJson.layerCount },
    (_, z) => z,
  )
  const connectionPoints = getConnectionPoints(simpleRouteJson)
  const connectionSegments = simpleRouteJson.connections.flatMap(
    (connection) => {
      const start = connection.pointsToConnect[0]
      const end = connection.pointsToConnect.at(-1)
      return start && end && start !== end ? [{ start, end }] : []
    },
  )
  const nodes: CapacityMeshNode[] = []

  const finalizeNode = (node: CapacityMeshNode): CapacityMeshNode => {
    node._containsTarget = connectionPoints.some((point) =>
      pointIsInsideNode(point, node),
    )
    node._containsObstacle = simpleRouteJson.obstacles.some((obstacle) =>
      obstacleOverlapsNode(obstacle, node),
    )
    node._completelyInsideObstacle = false
    node._obstacleOccupancyFraction = getObstacleOccupancyFraction({
      node,
      obstacles: params.obstacleGeometry,
    })
    // Terminal-adjacent leaves are local precision regions, but they are not
    // component topology. Keeping the markers distinct lets Pipeline10 retain
    // exact component routing without sending every refined terminal cell
    // through the expensive exact intra-node solver.
    node._isApproximateTerminalRefinement = node._containsTarget || undefined
    return node
  }

  const shouldRefineNode = (node: CapacityMeshNode): boolean => {
    if (
      connectionPoints.some((point) => pointIsInsideNode(point, node)) ||
      simpleRouteJson.obstacles.some((obstacle) =>
        obstacleOverlapsNode(obstacle, node, params.refinementMargin),
      )
    ) {
      return true
    }

    let crossingHintCount = 0
    for (const segment of connectionSegments) {
      if (!segmentIntersectsNode(segment, node)) continue
      crossingHintCount++
      if (crossingHintCount >= DEFAULT_CONGESTION_REFINEMENT_THRESHOLD) {
        return true
      }
    }
    return false
  }

  const refineNode = (
    node: CapacityMeshNode,
    depth: number,
  ): CapacityMeshNode[] => {
    if (depth >= params.localRefinementDepth || !shouldRefineNode(node)) {
      return [finalizeNode(node)]
    }

    const childWidth = node.width / 2
    const childHeight = node.height / 2
    return [
      { xDirection: -1, yDirection: -1, label: "sw" },
      { xDirection: 1, yDirection: -1, label: "se" },
      { xDirection: -1, yDirection: 1, label: "nw" },
      { xDirection: 1, yDirection: 1, label: "ne" },
    ].flatMap(({ xDirection, yDirection, label }) =>
      refineNode(
        {
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}:${label}`,
          center: {
            x: node.center.x + (xDirection * childWidth) / 2,
            y: node.center.y + (yDirection * childHeight) / 2,
          },
          width: childWidth,
          height: childHeight,
        },
        depth + 1,
      ),
    )
  }

  for (let row = 0; row < dimensions.rowCount; row++) {
    for (let column = 0; column < dimensions.columnCount; column++) {
      const node: CapacityMeshNode = {
        capacityMeshNodeId: `approx-grid:r${row}:c${column}`,
        center: {
          x:
            simpleRouteJson.bounds.minX +
            (column + 0.5) * dimensions.cellWidth,
          y:
            simpleRouteJson.bounds.minY +
            (row + 0.5) * dimensions.cellHeight,
        },
        width: dimensions.cellWidth,
        height: dimensions.cellHeight,
        layer: `z${allZ.join(",")}`,
        availableZ: [...allZ],
        _skipEndpointNetReservation: true,
      }
      nodes.push(...refineNode(node, 0))
    }
  }
  return nodes
}

const getNodeAt = (params: {
  nodes: CapacityMeshNode[]
  dimensions: GridDimensions
  row: number
  column: number
}): CapacityMeshNode => {
  const node =
    params.nodes[params.row * params.dimensions.columnCount + params.column]
  if (!node) {
    throw new Error(
      `Pipeline10 approximate grid is missing row ${params.row}, column ${params.column}`,
    )
  }
  return node
}

const getPortPositions = (params: {
  boundary: SharedBoundary
  maxPorts: number
  traceWidth: number
  obstacleMargin: number
}): Array<{ x: number; y: number }> => {
  const dx = params.boundary.end.x - params.boundary.start.x
  const dy = params.boundary.end.y - params.boundary.start.y
  const length = Math.hypot(dx, dy)
  const pitch = Math.max(1e-3, params.traceWidth + params.obstacleMargin)
  const desiredCount = Math.max(1, Math.floor(length / pitch))
  const portCount = Math.min(params.maxPorts, desiredCount)
  const edgeMargin = Math.min(length / 4, pitch * 0.75)
  const usableLength = Math.max(0, length - edgeMargin * 2)
  return Array.from({ length: portCount }, (_, portIndex) => {
    const offset =
      portCount === 1
        ? length / 2
        : edgeMargin + (usableLength * portIndex) / (portCount - 1)
    const fraction = length === 0 ? 0.5 : offset / length
    return {
      x: params.boundary.start.x + dx * fraction,
      y: params.boundary.start.y + dy * fraction,
    }
  })
}

const createSharedEdgeSegment = (params: {
  edgeId: string
  node1: CapacityMeshNode
  node2: CapacityMeshNode
  boundary: SharedBoundary
  simpleRouteJson: SimpleRouteJson
  maxPortsPerLayerPerEdge: number
  obstacleSamplingMargin: number
  obstacleZLayers: Map<Obstacle, number[]>
}): { segment: SharedEdgeSegment | null; rejectedPortCount: number } => {
  const candidatePositions = getPortPositions({
    boundary: params.boundary,
    maxPorts: params.maxPortsPerLayerPerEdge,
    traceWidth: params.simpleRouteJson.minTraceWidth,
    obstacleMargin: params.simpleRouteJson.defaultObstacleMargin ?? 0.15,
  })
  const centerIndex = Math.floor((candidatePositions.length - 1) / 2)
  const portPoints: SegmentPortPoint[] = []
  let rejectedPortCount = 0

  for (let z = 0; z < params.simpleRouteJson.layerCount; z++) {
    for (const [portIndex, point] of candidatePositions.entries()) {
      if (
        pointIsBlockedByObstacle({
          point,
          z,
          obstacles: params.simpleRouteJson.obstacles,
          obstacleZLayers: params.obstacleZLayers,
          margin: params.obstacleSamplingMargin,
        })
      ) {
        rejectedPortCount++
        continue
      }
      portPoints.push({
        segmentPortPointId: `${params.edgeId}:z${z}:p${portIndex}`,
        x: point.x,
        y: point.y,
        availableZ: [z],
        nodeIds: [
          params.node1.capacityMeshNodeId,
          params.node2.capacityMeshNodeId,
        ],
        edgeId: params.edgeId,
        connectionName: null,
        distToCentermostPortOnZ: Math.abs(portIndex - centerIndex),
        cramped: false,
      })
    }
  }

  const availableZ = [
    ...new Set(portPoints.flatMap((portPoint) => portPoint.availableZ)),
  ].sort((a, b) => a - b)
  return {
    segment:
      portPoints.length === 0
        ? null
        : {
            edgeId: params.edgeId,
            nodeIds: [
              params.node1.capacityMeshNodeId,
              params.node2.capacityMeshNodeId,
            ],
            start: params.boundary.start,
            end: params.boundary.end,
            availableZ,
            portPoints,
          },
    rejectedPortCount,
  }
}

const getGridEdgesAndSegments = (params: {
  simpleRouteJson: SimpleRouteJson
  dimensions: GridDimensions
  nodes: CapacityMeshNode[]
  maxPortsPerLayerPerEdge: number
  obstacleSamplingMargin: number
}): {
  capacityMeshEdges: CapacityMeshEdge[]
  sharedEdgeSegments: SharedEdgeSegment[]
  rejectedPortCount: number
} => {
  const capacityMeshEdges: CapacityMeshEdge[] = []
  const sharedEdgeSegments: SharedEdgeSegment[] = []
  const obstacleZLayers = new Map(
    params.simpleRouteJson.obstacles.map((obstacle) => [
      obstacle,
      getObstacleZLayers(obstacle, params.simpleRouteJson.layerCount),
    ]),
  )
  let rejectedPortCount = 0

  const addEdge = (
    edgeId: string,
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
    boundary: SharedBoundary,
  ): void => {
    const result = createSharedEdgeSegment({
      edgeId,
      node1,
      node2,
      boundary,
      simpleRouteJson: params.simpleRouteJson,
      maxPortsPerLayerPerEdge: params.maxPortsPerLayerPerEdge,
      obstacleSamplingMargin: params.obstacleSamplingMargin,
      obstacleZLayers,
    })
    rejectedPortCount += result.rejectedPortCount
    if (!result.segment) return
    capacityMeshEdges.push({
      capacityMeshEdgeId: edgeId,
      nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
    })
    sharedEdgeSegments.push(result.segment)
  }

  for (let row = 0; row < params.dimensions.rowCount; row++) {
    for (let column = 0; column < params.dimensions.columnCount; column++) {
      const node = getNodeAt({ ...params, row, column })
      const left = node.center.x - node.width / 2
      const right = node.center.x + node.width / 2
      const bottom = node.center.y - node.height / 2
      const top = node.center.y + node.height / 2

      if (column + 1 < params.dimensions.columnCount) {
        addEdge(
          `approx-edge:r${row}:c${column}:right`,
          node,
          getNodeAt({ ...params, row, column: column + 1 }),
          { start: { x: right, y: bottom }, end: { x: right, y: top } },
        )
      }
      if (row + 1 < params.dimensions.rowCount) {
        addEdge(
          `approx-edge:r${row}:c${column}:top`,
          node,
          getNodeAt({ ...params, row: row + 1, column }),
          { start: { x: left, y: top }, end: { x: right, y: top } },
        )
      }
    }
  }
  return { capacityMeshEdges, sharedEdgeSegments, rejectedPortCount }
}

export class ApproximateHypergraphTopologySolver extends BaseSolver {
  readonly params: ApproximateHypergraphTopologySolverParams
  output?: ApproximateHypergraphTopologyOutput

  constructor(params: ApproximateHypergraphTopologySolverParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 1
    const targetCellSize = params.targetCellSize ?? DEFAULT_TARGET_CELL_SIZE
    const maxPorts =
      params.maxPortsPerLayerPerEdge ??
      DEFAULT_MAX_PORTS_PER_LAYER_PER_EDGE
    const localRefinementDepth = params.localRefinementDepth ?? 0
    if (!Number.isFinite(targetCellSize) || targetCellSize <= 0) {
      throw new Error("Pipeline10 targetCellSize must be greater than zero")
    }
    if (!Number.isInteger(maxPorts) || maxPorts <= 0) {
      throw new Error(
        "Pipeline10 maxPortsPerLayerPerEdge must be a positive integer",
      )
    }
    if (
      !Number.isInteger(localRefinementDepth) ||
      localRefinementDepth < 0 ||
      localRefinementDepth > 6
    ) {
      throw new Error(
        "Pipeline10 localRefinementDepth must be an integer between 0 and 6",
      )
    }
    if (
      localRefinementDepth > 0 &&
      params.generatePortsAndEdges !== false
    ) {
      throw new Error(
        "Pipeline10 adaptive refinement requires downstream edge generation",
      )
    }
  }

  override getSolverName(): string {
    return "ApproximateHypergraphTopologySolver"
  }

  override getConstructorParams(): [ApproximateHypergraphTopologySolverParams] {
    return [this.params]
  }

  override _step(): void {
    const targetCellSize =
      this.params.targetCellSize ?? DEFAULT_TARGET_CELL_SIZE
    const maxPortsPerLayerPerEdge =
      this.params.maxPortsPerLayerPerEdge ??
      DEFAULT_MAX_PORTS_PER_LAYER_PER_EDGE
    const localRefinementDepth = this.params.localRefinementDepth ?? 0
    const dimensions = getGridDimensions(
      this.params.simpleRouteJson,
      targetCellSize,
    )
    const capacityMeshNodes = getGridNodes({
      simpleRouteJson: this.params.simpleRouteJson,
      dimensions,
      localRefinementDepth,
      refinementMargin:
        this.params.obstacleSamplingMargin ??
        Math.max(
          this.params.simpleRouteJson.defaultObstacleMargin ?? 0.15,
          this.params.simpleRouteJson.minTraceWidth,
        ),
      obstacleGeometry: prepareObstacleGeometry({
        obstacles: this.params.simpleRouteJson.obstacles,
        layerCount: this.params.simpleRouteJson.layerCount,
        margin:
          this.params.obstacleSamplingMargin ??
          this.params.simpleRouteJson.minTraceWidth / 2,
      }),
    })
    const topology =
      this.params.generatePortsAndEdges === false
        ? {
            capacityMeshEdges: [],
            sharedEdgeSegments: [],
            rejectedPortCount: 0,
          }
        : getGridEdgesAndSegments({
            simpleRouteJson: this.params.simpleRouteJson,
            dimensions,
            nodes: capacityMeshNodes,
            maxPortsPerLayerPerEdge,
            obstacleSamplingMargin:
              this.params.obstacleSamplingMargin ??
              this.params.simpleRouteJson.minTraceWidth / 2,
          })
    const portCount = topology.sharedEdgeSegments.reduce(
      (total, segment) => total + segment.portPoints.length,
      0,
    )
    const obstacleOccupancies = capacityMeshNodes.map(
      (node) => node._obstacleOccupancyFraction ?? 0,
    )
    const stats: ApproximateHypergraphTopologyStats = {
      columnCount: dimensions.columnCount,
      rowCount: dimensions.rowCount,
      regionCount: capacityMeshNodes.length,
      edgeCount: topology.capacityMeshEdges.length,
      portCount,
      rejectedPortCount: topology.rejectedPortCount,
      targetCellSize,
      maxPortsPerLayerPerEdge,
      localRefinementDepth,
      obstacleOccupiedRegionCount: obstacleOccupancies.filter(
        (occupancy) => occupancy > 0,
      ).length,
      meanObstacleOccupancyFraction:
        obstacleOccupancies.reduce((sum, occupancy) => sum + occupancy, 0) /
        Math.max(1, obstacleOccupancies.length),
      maxObstacleOccupancyFraction: obstacleOccupancies.reduce(
        (maximum, occupancy) => Math.max(maximum, occupancy),
        0,
      ),
    }
    this.output = {
      capacityMeshNodes,
      capacityMeshEdges: topology.capacityMeshEdges,
      sharedEdgeSegments: topology.sharedEdgeSegments,
      stats,
    }
    this.stats = { ...stats }
    this.solved = true
  }

  getOutput(): ApproximateHypergraphTopologyOutput {
    if (!this.output) {
      throw new Error(
        "ApproximateHypergraphTopologySolver output requested before solve",
      )
    }
    return this.output
  }

  override visualize(): GraphicsObject {
    const output = this.output
    return {
      title: "Pipeline10 approximate hypergraph topology",
      rects: (output?.capacityMeshNodes ?? []).map((node) => ({
        center: node.center,
        width: node.width,
        height: node.height,
        fill: node._containsObstacle
          ? "rgba(245, 158, 11, 0.08)"
          : "rgba(14, 165, 233, 0.06)",
        stroke: "rgba(14, 116, 144, 0.5)",
        label: node.capacityMeshNodeId,
        layer: node.layer,
      })),
      points: (output?.sharedEdgeSegments ?? []).flatMap((segment) =>
        segment.portPoints.map((portPoint) => ({
          x: portPoint.x,
          y: portPoint.y,
          color: "#0e7490",
          label: portPoint.segmentPortPointId,
          layer: `z${portPoint.availableZ[0]}`,
        })),
      ),
      lines: [],
      circles: [],
    }
  }
}
