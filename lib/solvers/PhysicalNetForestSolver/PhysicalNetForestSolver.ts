import { pointToSegmentDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import type { ConnectionPoint, Obstacle, SimpleRouteConnection, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import {
  getPipeline9PhysicalObstacleOwner,
  getPipeline9PhysicalOwnership,
  getPipeline9PhysicalRouteOwner,
  type Pipeline9PhysicalOwnership,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { assertPhysicalForestConnectivity } from "./assertPhysicalForestConnectivity"

type Point = { x: number; y: number }
type Branch = { start: Point; end: Point; traceId: string }
type Candidate = { terminal: ConnectionPoint; target: Point; attachesTo: string; distance: number }

/**
 * Construct physical copper before terminal pairs exist. Eligibility requires a
 * complete visible terminal graph: an obstructed net remains an ordinary net,
 * rather than turning bounded search exhaustion into a connectivity claim.
 * Once eligible, each new terminal attaches to existing copper, not a copied
 * path to another demand's destination. connectsTo records those actual joins.
 */
export class PhysicalNetForestSolver extends BaseSolver {
  readonly branches: SimplifiedPcbTrace[] = []
  readonly diagnostics = {
    consideredNets: 0,
    eligibleNets: 0,
    committedNets: 0,
    committedBranches: 0,
    interiorAttachments: 0,
    avoidedPairDemands: 0,
    copperLength: 0,
    visibleTerminalGraphLength: 0,
    rejectedConstraints: 0,
    rejectedVisibility: 0,
    segmentChecks: 0,
    physicallyValidatedNets: 0,
  }
  private readonly committedConnections: SimpleRouteConnection[] = []
  private readonly pending: SimpleRouteConnection[]
  readonly physicalOwnership: Pipeline9PhysicalOwnership
  private readonly obstacleOwners = new WeakMap<Obstacle, string | undefined>()
  private readonly constrainedNames: Set<string>
  private readonly traceIds: Set<string>

  constructor(readonly inputSrj: SimpleRouteJson, readonly enabled = true, originalSrj: SimpleRouteJson = inputSrj) {
    super()
    this.pending = enabled ? mergeConnections(inputSrj.connections) : []
    this.physicalOwnership = getPipeline9PhysicalOwnership({
      originalSrj,
      derivedConnections: [...inputSrj.connections, ...this.pending],
      derivedTraces: inputSrj.traces,
    })
    for (const obstacle of inputSrj.obstacles) {
      this.obstacleOwners.set(obstacle, getPipeline9PhysicalObstacleOwner(this.physicalOwnership, obstacle))
    }
    this.constrainedNames = new Set([
      ...(inputSrj.buses ?? []).flatMap((bus) => bus.connectionNames),
      ...(inputSrj.differentialPairs ?? []).flatMap((pair) => pair.connectionNames),
    ])
    this.traceIds = new Set((inputSrj.traces ?? []).map((trace) => trace.pcb_trace_id))
    this.stats = this.diagnostics
  }

  private isSameNet(name: string, other: string): boolean {
    const owner = getPipeline9PhysicalRouteOwner(this.physicalOwnership, { connectionName: name })
    const otherOwner = getPipeline9PhysicalRouteOwner(this.physicalOwnership, { connectionName: other })
    return owner !== undefined && owner === otherOwner
  }

  private isClear(start: Point, end: Point, layer: string, width: number, name: string): boolean {
    this.diagnostics.segmentChecks++
    const radius = width / 2
    const boardMargin = radius + (this.inputSrj.minBoardEdgeClearance ?? 0.2)
    const bounds = this.inputSrj.bounds
    for (const point of [start, end]) {
      if (point.x < bounds.minX + boardMargin || point.x > bounds.maxX - boardMargin ||
        point.y < bounds.minY + boardMargin || point.y > bounds.maxY - boardMargin) return false
    }
    const outline = this.inputSrj.outline
    if (outline && (doesSegmentCrossPolygonBoundary({ start, end, polygon: outline, margin: boardMargin }) ||
      outline.some((point, index) => minimumDistanceBetweenSegments(start, end, point,
        outline[(index + 1) % outline.length]!) < boardMargin))) return false
    const margin = this.inputSrj.defaultObstacleMargin ?? 0.15
    const owner = getPipeline9PhysicalRouteOwner(this.physicalOwnership, { connectionName: name })
    for (const obstacle of this.inputSrj.obstacles) {
      if ((!obstacle.isNonPlatedHole && !obstacle.layers.includes(layer)) || (!obstacle.isNonPlatedHole &&
        owner !== undefined && owner === this.obstacleOwners.get(obstacle))) continue
      const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const localStart = { x: (start.x - obstacle.center.x) * cos - (start.y - obstacle.center.y) * sin,
        y: (start.x - obstacle.center.x) * sin + (start.y - obstacle.center.y) * cos }
      const localEnd = { x: (end.x - obstacle.center.x) * cos - (end.y - obstacle.center.y) * sin,
        y: (end.x - obstacle.center.x) * sin + (end.y - obstacle.center.y) * cos }
      const gap = obstacle.isNonPlatedHole
        ? (this.inputSrj.minTraceToHoleEdgeClearance ?? 0.2)
        : (this.inputSrj.minTraceToPadEdgeClearance ?? margin)
      if (segmentToBoxMinDistance(localStart, localEnd, { center: { x: 0, y: 0 },
        width: obstacle.width, height: obstacle.height }) < radius + gap + 1e-6) return false
    }
    for (const trace of [...(this.inputSrj.traces ?? []), ...this.branches]) {
      if (this.isSameNet(name, trace.connection_name)) continue
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        if (point.route_type === "via") {
          if (pointToSegmentDistance(point, start, end) < radius + (point.via_diameter ?? 0.6) / 2 + margin + 1e-6) return false
        } else if (point.route_type === "wire") {
          const next = trace.route[index + 1]
          if (point.layer === layer && next?.route_type === "wire" && next.layer === layer &&
            minimumDistanceBetweenSegments(start, end, point, next) < radius + Math.max(point.width, next.width) / 2 + margin + 1e-6) return false
        } else {
          // Unsupported fixed-copper primitives never establish eligibility.
          return false
        }
      }
    }
    return true
  }

  private getEligibleLayer(connection: SimpleRouteConnection): string | undefined {
    const points = connection.pointsToConnect
    const names = [connection.name, ...(connection.__rootConnectionNames ?? [])]
    if (getPipeline9PhysicalRouteOwner(this.physicalOwnership, { connectionName: connection.name }) === undefined ||
      connection.isOffBoard || (connection.externallyConnectedPointIds?.length ?? 0) > 0 ||
      points.length < 3 || points.length > 24 || names.some((name) => this.constrainedNames.has(name)) ||
      points.some((point) => !point.pointId || ("terminalVia" in point && point.terminalVia)) ||
      new Set(points.map((point) => point.pointId)).size !== points.length ||
      new Set(points.map((point) => `${point.x},${point.y}`)).size !== points.length ||
      (this.inputSrj.traces ?? []).some((trace) => names.some((name) => this.isSameNet(name, trace.connection_name)))) return undefined
    const layers = getConnectionPointLayers(points[0]!).filter((layer) =>
      points.every((point) => getConnectionPointLayers(point).includes(layer)))
    return layers[0]
  }

  private getVisibleTree(connection: SimpleRouteConnection, layer: string, width: number): boolean {
    const points = connection.pointsToConnect
    const connected = new Set([0])
    let length = 0
    while (connected.size < points.length) {
      let best: { index: number; distance: number } | undefined
      for (let index = 0; index < points.length; index++) {
        if (connected.has(index)) continue
        for (const from of connected) {
          const distance = Math.hypot(points[index]!.x - points[from]!.x, points[index]!.y - points[from]!.y)
          if ((!best || distance < best.distance) && this.isClear(points[index]!, points[from]!, layer, width, connection.name)) best = { index, distance }
        }
      }
      if (!best) return false
      connected.add(best.index)
      length += best.distance
    }
    this.diagnostics.visibleTerminalGraphLength += length
    return true
  }

  private growPhysicalTree(connection: SimpleRouteConnection, layer: string, width: number): void {
    const points = [...connection.pointsToConnect]
    const seed = points.shift()!
    const tree: Branch[] = []
    const terminals = [seed]
    while (points.length > 0) {
      let best: Candidate | undefined
      for (const terminal of points) {
        const targets: Array<{ target: Point; attachesTo: string }> = terminals.map((target) => ({ target, attachesTo: target.pointId! }))
        for (const branch of tree) {
          const dx = branch.end.x - branch.start.x, dy = branch.end.y - branch.start.y
          const fraction = Math.max(0, Math.min(1, ((terminal.x - branch.start.x) * dx +
            (terminal.y - branch.start.y) * dy) / (dx * dx + dy * dy)))
          targets.push({ target: { x: branch.start.x + dx * fraction, y: branch.start.y + dy * fraction },
            attachesTo: branch.traceId })
        }
        for (const { target, attachesTo } of targets) {
          const distance = Math.hypot(terminal.x - target.x, terminal.y - target.y)
          if ((!best || distance < best.distance) && this.isClear(terminal, target, layer, width, connection.name)) best = { terminal, target, attachesTo, distance }
        }
      }
      if (!best) throw new Error("Visible physical-net tree lost a certified attachment")
      if (best.distance <= 1e-9) {
        const parent = this.branches.find((trace) => trace.pcb_trace_id === best!.attachesTo)
        if (!parent) throw new Error("Zero-length forest join has no physical parent copper")
        parent.connectsTo!.push(best.terminal.pointId!)
        terminals.push(best.terminal)
        points.splice(points.indexOf(best.terminal), 1)
        this.diagnostics.interiorAttachments++
        continue
      }
      const branchIndex = this.branches.length
      let traceId = `pipeline9_forest_${branchIndex}`
      while (this.traceIds.has(traceId)) traceId += "_new"
      this.traceIds.add(traceId)
      const trace: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: traceId,
        connection_name: connection.name, connectsTo: [best.terminal.pointId!, best.attachesTo],
        route: [
          { route_type: "wire", x: best.terminal.x, y: best.terminal.y, width, layer,
            ...(best.terminal.pcb_port_id ? { start_pcb_port_id: best.terminal.pcb_port_id } : {}) },
          { route_type: "wire", x: best.target.x, y: best.target.y, width, layer },
        ] }
      if (tree.some((branch) => branch.traceId === best!.attachesTo &&
        Math.hypot(best!.target.x - branch.start.x, best!.target.y - branch.start.y) > 1e-6 &&
        Math.hypot(best!.target.x - branch.end.x, best!.target.y - branch.end.y) > 1e-6)) this.diagnostics.interiorAttachments++
      this.branches.push(trace)
      tree.push({ start: best.terminal, end: best.target, traceId })
      terminals.push(best.terminal)
      points.splice(points.indexOf(best.terminal), 1)
      this.diagnostics.committedBranches++
      this.diagnostics.copperLength += best.distance
    }
    this.diagnostics.committedNets++
    this.diagnostics.avoidedPairDemands += connection.pointsToConnect.length - 1
    this.committedConnections.push(connection)
  }

  override _step(): void {
    const connection = this.pending.pop()
    if (!connection) { this.solved = true; return }
    this.diagnostics.consideredNets++
    const layer = this.getEligibleLayer(connection)
    if (!layer) { this.diagnostics.rejectedConstraints++; return }
    const width = Math.max(this.inputSrj.minTraceWidth, connection.nominalTraceWidth ?? connection.width ?? this.inputSrj.nominalTraceWidth ?? this.inputSrj.minTraceWidth)
    if (!Number.isFinite(width) || width <= 0) throw new Error("Physical forest requires finite positive copper width")
    if (!this.getVisibleTree(connection, layer, width)) { this.diagnostics.rejectedVisibility++; return }
    this.diagnostics.eligibleNets++
    this.growPhysicalTree(connection, layer, width)
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    if (!this.solved || this.failed) throw new Error("Physical forest output requires completed eligibility construction")
    return { ...this.inputSrj, traces: [...(this.inputSrj.traces ?? []), ...this.branches] }
  }

  assertOutputPhysicalConnectivity(traces: SimplifiedPcbTrace[]): void {
    this.diagnostics.physicallyValidatedNets = assertPhysicalForestConnectivity({
      connections: this.committedConnections,
      traces,
      layerCount: this.inputSrj.layerCount,
      areSameNet: (name, other) => this.isSameNet(name, other),
    })
  }
}
