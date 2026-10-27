import { segmentToBoxMinDistance, segmentToCircleMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { isObstacleConnectedToRoute } from "../../solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { doPipeline9RoutesHaveCopperConflict } from "./pipeline9FixedRouteCopper"

export type Pipeline9PhysicalTerminal = Pick<PortPoint, "x" | "y" | "z"> & {
  connectionName?: string
  rootConnectionName?: string
}

export type Pipeline9StraightCellCertificate =
  | { certified: true; routes: HighDensityRoute[] }
  | { certified: false; reason: "pairing" | "layer" | "bounds" | "copper" | "obstacle" | "board" | "terminal" }

type CertifierInput = {
  obstacles: Obstacle[]
  physicalTerminals: readonly Pipeline9PhysicalTerminal[]
  layerCount: number
  traceWidth: number
  traceWidthByConnectionName?: ReadonlyMap<string, number>
  clearance: number
  minTraceToHoleEdgeClearance?: number
  boardGeometry?: HighDensityBoardGeometry
  connMap?: ConnectivityMap
}

const EPSILON = 1e-8

/** A constructive witness, not a clearance score: every local connection is
 * represented by real finite-width straight copper, and the entire cell must
 * pass geometric checks together. Cells requiring bends or vias are ineligible. */
export class Pipeline9StraightCellCertifier {
  private obstaclesByNode = new Map<string, Obstacle[]>()
  private terminalsByNode = new Map<string, Pipeline9PhysicalTerminal[]>()
  private boardPolygon: { x: number; y: number }[] | undefined

  constructor(private input: CertifierInput) {
    if (!Number.isInteger(input.layerCount) || input.layerCount < 1 || !Number.isFinite(input.traceWidth) || input.traceWidth <= 0 ||
      !Number.isFinite(input.clearance) || input.clearance < 0 || [...(input.traceWidthByConnectionName?.values() ?? [])].some((width) => !Number.isFinite(width) || width <= 0)) {
      throw new Error("Invalid straight-cell witness configuration")
    }
    const board = input.boardGeometry
    this.boardPolygon = board?.outline && board.outline.length >= 3 ? board.outline : board ? [
      { x: board.bounds.minX, y: board.bounds.minY }, { x: board.bounds.maxX, y: board.bounds.minY },
      { x: board.bounds.maxX, y: board.bounds.maxY }, { x: board.bounds.minX, y: board.bounds.maxY },
    ] : undefined
  }

  private sameNet(left: { connectionName?: string; rootConnectionName?: string }, right: { connectionName?: string; rootConnectionName?: string }): boolean {
    const leftIds = [left.connectionName, left.rootConnectionName].filter((id): id is string => id !== undefined)
    const rightIds = [right.connectionName, right.rootConnectionName].filter((id): id is string => id !== undefined)
    return leftIds.some((a) => rightIds.some((b) => a === b || (this.input.connMap?.areIdsConnected(a, b) ?? false)))
  }

  private widthFor(point: { connectionName?: string; rootConnectionName?: string }): number {
    const widths = this.input.traceWidthByConnectionName
    return Math.max(this.input.traceWidth,
      (point.connectionName ? widths?.get(point.connectionName) : undefined) ??
      (point.rootConnectionName ? widths?.get(point.rootConnectionName) : undefined) ?? this.input.traceWidth,
    )
  }

  certifyJointNodes(nodes: readonly NodeWithPortPoints[], proposed: ReadonlyMap<string, { x: number; y: number }>): Pipeline9StraightCellCertificate {
    const routes: HighDensityRoute[] = []
    for (const node of nodes) {
      const certificate = this.certify(node, proposed)
      if (!certificate.certified) return certificate
      for (const route of certificate.routes) for (const previous of routes) {
        if (this.sameNet(route, previous)) continue
        if (doPipeline9RoutesHaveCopperConflict({ left: route, right: previous, clearance: this.input.clearance, layerCount: this.input.layerCount })) {
          return { certified: false, reason: "copper" }
        }
      }
      routes.push(...certificate.routes)
    }
    return { certified: true, routes }
  }

  certify(node: NodeWithPortPoints, proposed: ReadonlyMap<string, { x: number; y: number }>): Pipeline9StraightCellCertificate {
    const pairs = node.portPointsInPairs
    if (!pairs || pairs.length * 2 !== node.portPoints.length) return { certified: false, reason: "pairing" }
    const flattened = pairs.flat()
    if (new Set(flattened.map((point) => point.portPointId)).size !== flattened.length ||
      flattened.some((point) => !point.portPointId || !node.portPoints.some((entry) => entry.portPointId === point.portPointId && entry.connectionName === point.connectionName &&
        entry.x === point.x && entry.y === point.y && entry.z === point.z && entry.rootConnectionName === point.rootConnectionName && entry.pcb_port_id === point.pcb_port_id))) {
      return { certified: false, reason: "pairing" }
    }
    const routes: HighDensityRoute[] = []
    for (const pair of pairs) {
      if (pair[0].connectionName !== pair[1].connectionName) return { certified: false, reason: "pairing" }
      if (pair[0].z !== pair[1].z || !Number.isInteger(pair[0].z) || pair[0].z < 0 || pair[0].z >= this.input.layerCount ||
        !node.availableZ?.includes(pair[0].z)) return { certified: false, reason: "layer" }
      const points = pair.map((point) => ({ ...point, ...(proposed.get(point.portPointId!) ?? {}) }))
      if (points.some((point) => Math.abs(point.x - node.center.x) > node.width / 2 + EPSILON || Math.abs(point.y - node.center.y) > node.height / 2 + EPSILON)) {
        return { certified: false, reason: "bounds" }
      }
      routes.push({ connectionName: pair[0].connectionName, rootConnectionName: pair[0].rootConnectionName,
        startPcbPortId: pair[0].pcb_port_id, endPcbPortId: pair[1].pcb_port_id,
        traceThickness: this.widthFor(pair[0]), viaDiameter: 0, vias: [],
        route: points, regionId: node.capacityMeshNodeId,
      })
    }
    for (let a = 0; a < routes.length; a++) for (let b = a + 1; b < routes.length; b++) {
      if (this.sameNet(routes[a]!, routes[b]!)) continue
      if (doPipeline9RoutesHaveCopperConflict({ left: routes[a]!, right: routes[b]!, clearance: this.input.clearance, layerCount: this.input.layerCount })) {
        return { certified: false, reason: "copper" }
      }
    }
    const largestWidth = Math.max(this.input.traceWidth, ...(this.input.traceWidthByConnectionName?.values() ?? []))
    const margin = largestWidth + Math.max(this.input.clearance, this.input.minTraceToHoleEdgeClearance ?? 0)
    let obstacles = this.obstaclesByNode.get(node.capacityMeshNodeId)
    if (!obstacles) {
      obstacles = this.input.obstacles.filter((obstacle) => {
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const halfX = (Math.abs(Math.cos(angle)) * obstacle.width + Math.abs(Math.sin(angle)) * obstacle.height) / 2
        const halfY = (Math.abs(Math.sin(angle)) * obstacle.width + Math.abs(Math.cos(angle)) * obstacle.height) / 2
        return Math.abs(obstacle.center.x - node.center.x) <= node.width / 2 + halfX + margin &&
          Math.abs(obstacle.center.y - node.center.y) <= node.height / 2 + halfY + margin
      })
      this.obstaclesByNode.set(node.capacityMeshNodeId, obstacles)
    }
    let terminals = this.terminalsByNode.get(node.capacityMeshNodeId)
    if (!terminals) {
      terminals = this.input.physicalTerminals.filter((terminal) => Math.abs(terminal.x - node.center.x) <= node.width / 2 + margin && Math.abs(terminal.y - node.center.y) <= node.height / 2 + margin)
      this.terminalsByNode.set(node.capacityMeshNodeId, terminals)
    }
    for (const route of routes) {
      const start = route.route[0]!
      const end = route.route[1]!
      for (const obstacle of obstacles) {
        const layers = obstacle.zLayers ?? obstacle.__zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, this.input.layerCount))
        if (!layers.includes(start.z) || isObstacleConnectedToRoute(obstacle, route, this.input.connMap) ||
          (obstacle.obstacleId && this.input.connMap?.areIdsConnected(route.rootConnectionName ?? route.connectionName, obstacle.obstacleId))) continue
        const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const local = [start, end].map((point) => ({ x: (point.x - obstacle.center.x) * cos - (point.y - obstacle.center.y) * sin,
          y: (point.x - obstacle.center.x) * sin + (point.y - obstacle.center.y) * cos }))
        const distance = obstacle.shape === "circle" ? segmentToCircleMinDistance(start, end, { ...obstacle.center, radius: Math.max(obstacle.width, obstacle.height) / 2 }) :
          segmentToBoxMinDistance(local[0]!, local[1]!, { center: { x: 0, y: 0 }, width: obstacle.width, height: obstacle.height })
        const clearance = obstacle.isNonPlatedHole ? this.input.minTraceToHoleEdgeClearance ?? this.input.clearance : this.input.clearance
        if (distance < route.traceThickness / 2 + clearance) return { certified: false, reason: "obstacle" }
      }
      if (this.boardPolygon && (!isPointInOrOnPolygon(start, this.boardPolygon) || !isPointInOrOnPolygon(end, this.boardPolygon) ||
        this.boardPolygon.some((point, index) => minimumDistanceBetweenSegments(start, end, point, this.boardPolygon![(index + 1) % this.boardPolygon!.length]!) <
          route.traceThickness / 2 + (this.input.boardGeometry!.minBoardEdgeClearance ?? 0)))) {
        return { certified: false, reason: "board" }
      }
      for (const terminal of terminals) {
        if (terminal.z !== start.z || this.sameNet(terminal, route)) continue
        // Unlabelled terminals at a connection's exact endpoint belong to that
        // endpoint. Other unlabelled contacts remain finite-width reservations.
        if (!terminal.connectionName && [start, end].some((point) => Math.hypot(point.x - terminal.x, point.y - terminal.y) < EPSILON)) continue
        if (minimumDistanceBetweenSegments(start, end, terminal, terminal) < (route.traceThickness + this.widthFor(terminal)) / 2 + this.input.clearance) {
          return { certified: false, reason: "terminal" }
        }
      }
    }
    return { certified: true, routes }
  }
}
