import { checkViaPadClearance, checkViasOffBoard } from "@tscircuit/checks"
import { isPointInsideBounds, isPointInsidePolygon } from "@tscircuit/math-utils"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { type ConnectivityMap, getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getObstacleRouteConnectivity } from "../HyperHighDensitySolver/getObstacleRouteConnectivity"

type Point = { x: number; y: number; z: number }
type Task = {
  name: string
  root?: string
  owner: string
  terminals: Point[]
  columns: Column[]
}
type Column = {
  id: number
  route: HighDensityIntraNodeRoute
  fingerprint: string
  donor: string | object
}
export type RouteColumnPoolParams = {
  nodeWithPortPoints: NodeWithPortPoints
  layerCount: number
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  viaToPadClearance?: number
  allowBlindAndBuriedVias?: boolean
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  connMap?: ConnectivityMap
  workLimit: number
  diagnostics: Record<string, number>
}
class RouteColumnWorkLimit extends Error {}

/** A finite, bounded restricted master. Exhausting its columns proves no UNSAT. */
export class RouteColumnPool {
  readonly tasks: Task[] = []
  workLimit: number
  workUnits = 0
  eligible = false
  exhausted = false
  solvedRoutes?: HighDensityIntraNodeRoute[]
  private readonly taskByName = new Map<string, Task>()
  private readonly pairCompatibility = new Map<string, boolean>()
  private readonly seenRoutes = new WeakSet<HighDensityIntraNodeRoute>()
  private obstacles: Obstacle[] = []
  private nextColumnId = 0
  private preflight = true
  private preflightWorkUnits = 0
  private obstaclePadding = -1
  private readonly bounds: { minX: number; maxX: number; minY: number; maxY: number }

  constructor(readonly params: RouteColumnPoolParams) {
    this.workLimit = params.workLimit
    if (!Number.isSafeInteger(this.workLimit) || this.workLimit < 0)
      throw new Error("Invalid route column work allowance")
    if (!Number.isSafeInteger(params.layerCount) || params.layerCount < 1 ||
      !Number.isFinite(params.traceWidth) || params.traceWidth <= 0 ||
      !Number.isFinite(params.viaDiameter) || params.viaDiameter <= 0 ||
      !Number.isFinite(params.obstacleMargin) || params.obstacleMargin < 0 ||
      (params.viaHoleDiameter !== undefined && (!Number.isFinite(params.viaHoleDiameter) ||
        params.viaHoleDiameter <= 0 || params.viaHoleDiameter > params.viaDiameter)) ||
      (params.minViaHoleEdgeToViaHoleEdgeClearance !== undefined &&
        (!Number.isFinite(params.minViaHoleEdgeToViaHoleEdgeClearance) || params.minViaHoleEdgeToViaHoleEdgeClearance < 0)) ||
      (params.viaToPadClearance !== undefined && (!Number.isFinite(params.viaToPadClearance) || params.viaToPadClearance < 0)))
      throw new Error("Invalid route column physical geometry")
    const node = params.nodeWithPortPoints
    this.bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    this.record("routeColumnInstances")
    this.record("routeColumnAllocatedWorkUnits", this.workLimit)
    this.runBounded((): void => {
      if (node.portPoints.length > 64) {
        this.charge(1)
        this.record("routeColumnIneligibleInstances")
        return
      }
      const ownerTerminals = new Map<string, Set<string>>()
      for (const point of node.portPoints) {
        this.charge(2)
        let task = this.taskByName.get(point.connectionName)
        if (!task) {
          const net = params.connMap?.getNetConnectedToId(point.connectionName)
          if (net !== undefined) {
            const members = params.connMap!.netMap[net]
            if (!Array.isArray(members)) throw new Error("Missing route column owner members")
            this.charge(1 + members.length)
            if (!members.includes(point.connectionName))
              throw new Error("Stale route column indexed owner")
          }
          task = {
            name: point.connectionName,
            root: point.rootConnectionName,
            owner: JSON.stringify(net === undefined ? ["literal", point.connectionName] : ["registered", net]),
            terminals: [],
            columns: [],
          }
          this.taskByName.set(task.name, task)
          this.tasks.push(task)
        }
        if (task.root !== point.rootConnectionName)
          throw new Error("Inconsistent route column terminal ownership")
        if (!task.terminals.some((p) => p.x === point.x && p.y === point.y && p.z === point.z))
          task.terminals.push({ x: point.x, y: point.y, z: point.z })
        let terminals = ownerTerminals.get(task.owner)
        if (!terminals) {
          terminals = new Set()
          ownerTerminals.set(task.owner, terminals)
        }
        terminals.add(JSON.stringify([point.x, point.y, point.z]))
      }
      // Trees and paired decompositions need whole-tree columns, not one branch.
      this.eligible = this.tasks.length >= 2 && this.tasks.length <= 16 &&
        this.tasks.every((task) => task.terminals.length === 2) &&
        [...ownerTerminals.values()].every((terminals) => terminals.size === 2)
      if (!this.eligible) {
        this.record("routeColumnIneligibleInstances")
        return
      }
      this.record("routeColumnEligibleInstances")
    })
    this.preflight = false
  }

  private record(key: string, count = 1): void {
    const diagnostics = this.params.diagnostics
    diagnostics[key] = (diagnostics[key] ?? 0) + count
  }

  private charge(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid route column work charge")
    if (this.preflight) {
      if (this.preflightWorkUnits + count > 4096) throw new RouteColumnWorkLimit()
      this.preflightWorkUnits += count
      this.record("routeColumnPreflightWorkUnits", count)
      return
    }
    if (this.workUnits + count > this.workLimit)
      throw new RouteColumnWorkLimit()
    this.workUnits += count
    this.record("routeColumnWorkUnits", count)
  }

  private runBounded(operation: () => void): void {
    if (this.exhausted || this.solvedRoutes) return
    try {
      operation()
    } catch (error) {
      if (!(error instanceof RouteColumnWorkLimit)) throw error
      if (this.preflight) {
        this.eligible = false
        this.record("routeColumnPreflightUnknown")
        return
      }
      this.exhausted = true
      this.record("routeColumnBudgetUnknown")
    }
  }

  allocateWorkAllowance(allowance: number): void {
    if (!Number.isSafeInteger(allowance) || allowance < 0 ||
      this.workLimit !== 0 || this.workUnits !== 0 || !this.eligible)
      throw new Error("Invalid route column allowance transfer")
    this.workLimit = allowance
    this.record("routeColumnAllocatedWorkUnits", allowance)
  }

  private initializeObstacles(route: HighDensityIntraNodeRoute): void {
    // A donor may use wider copper than the configured minima. In particular,
    // boundary terminals can have a footprint outside the mesh interface.
    let wireWidth = this.params.traceWidth
    if (Number.isFinite(route.traceThickness)) wireWidth = Math.max(wireWidth, route.traceThickness)
    for (const point of route.route) {
      if (point.traceThickness !== undefined && Number.isFinite(point.traceThickness))
        wireWidth = Math.max(wireWidth, point.traceThickness)
    }
    const viaDiameter = Number.isFinite(route.viaDiameter)
      ? Math.max(this.params.viaDiameter, route.viaDiameter) : this.params.viaDiameter
    const padding = Math.max(this.params.viaDiameter + this.params.obstacleMargin,
      wireWidth / 2 + this.params.obstacleMargin,
      viaDiameter / 2 + Math.max(this.params.obstacleMargin, this.params.viaToPadClearance ?? 0))
    if (padding <= this.obstaclePadding) return
    const obstacles: Obstacle[] = []
    for (const obstacle of this.params.obstacles) {
      this.charge(1)
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2
      if (obstacle.center.x + radius >= this.bounds.minX - padding &&
        obstacle.center.x - radius <= this.bounds.maxX + padding &&
        obstacle.center.y + radius >= this.bounds.minY - padding &&
        obstacle.center.y - radius <= this.bounds.maxY + padding)
        obstacles.push(obstacle)
    }
    this.obstacles = obstacles
    this.obstaclePadding = padding
  }

  /** Conversion of donor-owned grid output is paid before calling getOutput. */
  payForDonorObservation(work: number): boolean {
    if (!this.eligible || this.exhausted || this.solvedRoutes) return false
    this.runBounded((): void => {
      this.charge(work)
    })
    return !this.exhausted
  }

  captureGridOutput(work: number, getRoutes: () => HighDensityIntraNodeRoute[], donor: string, attempt?: object): void {
    if (!this.eligible || this.exhausted || this.solvedRoutes) return
    this.runBounded((): void => {
      this.charge(work)
      for (const route of getRoutes()) this.offerRoute(route, donor, attempt)
    })
  }

  offerRoute(route: HighDensityIntraNodeRoute, donor: string, attempt?: object): void {
    if (!this.eligible || this.exhausted || this.solvedRoutes || this.seenRoutes.has(route)) return
    this.runBounded((): void => {
      this.charge(1)
      this.seenRoutes.add(route)
      const task = this.taskByName.get(route.connectionName)
      if (!task || task.columns.length >= 4 || route.route.length > 1024 || route.vias.length > 16) return
      this.charge(1 + 3 * route.route.length + route.vias.length)
      route = this.compactRoute(route)
      if (route.route.length > 256) return
      const fingerprint = JSON.stringify([route.traceThickness, route.viaDiameter, route.route, route.vias])
      if (task.columns.some((column) => column.fingerprint === fingerprint)) return
      this.record("routeColumnCandidates")
      if (!this.validateStaticRoute(route, task)) {
        return
      }
      this.charge(1 + route.route.length + route.vias.length)
      const copy: HighDensityIntraNodeRoute = {
        ...route,
        rootConnectionName: task.root,
        jumpers: undefined,
        route: route.route.map((point) => Object.freeze({ ...point })),
        vias: route.vias.map((via) => Object.freeze({ ...via })),
      }
      Object.freeze(copy.route)
      Object.freeze(copy.vias)
      Object.freeze(copy)
      task.columns.push({ id: this.nextColumnId++, route: copy, fingerprint, donor: attempt ?? donor })
      this.record("routeColumnAcceptedColumns")
      this.record(`routeColumnDonor_${donor}`)
      this.selectCompatibleColumns()
    })
  }

  private rejectStatic(reason: string): false {
    const diagnostics = this.params.diagnostics
    const key = `routeColumnRejected_${reason}`
    diagnostics[key] = (diagnostics[key] ?? 0) + 1
    this.record("routeColumnRejectedStatic")
    return false
  }

  private compactRoute(route: HighDensityIntraNodeRoute): HighDensityIntraNodeRoute {
    const points: HighDensityIntraNodeRoute["route"] = []
    for (const point of route.route) {
      while (points.length >= 2) {
        const a = points[points.length - 2]!, b = points[points.length - 1]!
        const abX = b.x - a.x, abY = b.y - a.y
        const bcX = point.x - b.x, bcY = point.y - b.y
        if (a.z !== b.z || b.z !== point.z ||
          a.traceThickness !== b.traceThickness || b.traceThickness !== point.traceThickness ||
          b.pcb_port_id || b.insideJumperPad || b.toNextSegmentType ||
          !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isSafeInteger(b.z) ||
          Math.abs(abX * bcY - abY * bcX) > 1e-12 || abX * bcX + abY * bcY < 0) break
        points.pop()
      }
      points.push(point)
    }
    return { ...route, route: points }
  }

  private validateStaticRoute(route: HighDensityIntraNodeRoute, task: Task): boolean {
    const { params, bounds } = this
    if (route.regionId !== params.nodeWithPortPoints.capacityMeshNodeId ||
      route.rootConnectionName !== task.root || route.route.length < 2 ||
      !Number.isFinite(route.traceThickness) || route.traceThickness < params.traceWidth ||
      !Number.isFinite(route.viaDiameter) || route.viaDiameter < params.viaDiameter ||
      (route.jumpers && route.jumpers.length > 0)) return this.rejectStatic("identityOrDimensions")
    const start = route.route[0]!, end = route.route.at(-1)!
    const matches = (a: Point, b: Point): boolean =>
      Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8 && a.z === b.z
    if (!((matches(start, task.terminals[0]!) && matches(end, task.terminals[1]!)) ||
      (matches(end, task.terminals[0]!) && matches(start, task.terminals[1]!)))) return this.rejectStatic("terminals")
    for (const [point, pcbPortId] of [[start, route.startPcbPortId], [end, route.endPcbPortId]] as const) {
      this.charge(params.nodeWithPortPoints.portPoints.length)
      const terminal = params.nodeWithPortPoints.portPoints.find((port) => port.connectionName === task.name && matches(port, point))!
      if ((pcbPortId !== undefined && pcbPortId !== terminal.pcb_port_id) ||
        (point.pcb_port_id !== undefined && point.pcb_port_id !== terminal.pcb_port_id)) return this.rejectStatic("portIdentity")
    }
    const transitions: { x: number; y: number }[] = []
    for (let i = 0; i < route.route.length; i++) {
      this.charge(1 + route.vias.length)
      const point = route.route[i]!
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return this.rejectStatic("nonfinitePoint")
      if (!Number.isSafeInteger(point.z) || point.z < 0 || point.z >= params.layerCount ||
        (params.nodeWithPortPoints.availableZ && !params.nodeWithPortPoints.availableZ.includes(point.z))) return this.rejectStatic("layer")
      if (point.x < bounds.minX - 1e-8 || point.x > bounds.maxX + 1e-8 ||
        point.y < bounds.minY - 1e-8 || point.y > bounds.maxY + 1e-8) return this.rejectStatic("nodeBounds")
      if (point.toNextSegmentType || point.insideJumperPad) return this.rejectStatic("unsupportedSegment")
      if (point.traceThickness !== undefined && (!Number.isFinite(point.traceThickness) || point.traceThickness < params.traceWidth)) return this.rejectStatic("pointWidth")
      if (i > 0 && i < route.route.length - 1 && !matches(point, start) && !matches(point, end)) {
        // Mesh edges are shared routing interfaces, not physical obstacles.
        // Keep internal copper footprints inside the cell. Native's explicit
        // terminal-stub exception remains, but never permits a center outside
        // the hard node bounds checked above. Real board clearance is separate.
        const inset = (point.traceThickness ?? route.traceThickness) / 2
        const nearTerminal = Math.hypot(point.x - start.x, point.y - start.y) < params.obstacleMargin ||
          Math.hypot(point.x - end.x, point.y - end.y) < params.obstacleMargin
        if (!nearTerminal && (point.x < bounds.minX + inset || point.x > bounds.maxX - inset ||
          point.y < bounds.minY + inset || point.y > bounds.maxY - inset)) return this.rejectStatic("nodeInterface")
      }
      const previous = route.route[i - 1]
      if (!previous || previous.z === point.z) continue
      // The first implementation accepts the unambiguous colocated via form.
      // Donor endpoint projections with simultaneous XY/Z movement stay in
      // their original candidate instead of reaching a stricter DRC adapter.
      if (Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8) return this.rejectStatic("noncolocatedTransition")
      const via = route.vias.find((v) => Math.hypot(v.x - point.x, v.y - point.y) < 1e-8) ??
        route.vias.find((v) => Math.hypot(v.x - previous.x, v.y - previous.y) < 1e-8)
      if (!via) return this.rejectStatic("missingVia")
      transitions.push(via)
    }
    const drillGap = (params.viaHoleDiameter ?? params.viaDiameter) +
      (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1)
    for (let i = 0; i < route.vias.length; i++) {
      const via = route.vias[i]!
      this.charge(1 + transitions.length + route.vias.length)
      const inset = route.viaDiameter / 2
      if (!Number.isFinite(via.x) || !Number.isFinite(via.y) ||
        !transitions.some((v) => Math.hypot(v.x - via.x, v.y - via.y) < 1e-8) ||
        via.x < bounds.minX + inset || via.x > bounds.maxX - inset ||
        via.y < bounds.minY + inset || via.y > bounds.maxY - inset) return this.rejectStatic("viaGeometry")
      for (let j = 0; j < i; j++) {
        const distance = Math.hypot(via.x - route.vias[j]!.x, via.y - route.vias[j]!.y)
        if (distance > 1e-8 && distance < drillGap) return this.rejectStatic("ownDrill")
      }
    }
    // Independent fixed-copper and physical-board validation. This does not
    // trust the donor's ancestor/order context, provisional congestion or DRC.
    this.initializeObstacles(route)
    const primitives = route.route.length + route.vias.length + 1
    this.charge(this.obstacles.length)
    const obstaclePrimitives = this.obstacles.reduce((sum, o) => sum + 4 + o.connectedTo.length, 0)
    const outlineSize = params.boardGeometry?.outline?.length ?? 0
    const padValidationWork = route.vias.length > 0 && this.obstacles.length > 0
      ? 4 * (primitives + obstaclePrimitives) ** 2 : 0
    const boardValidationWork = params.boardGeometry
      ? 4 * primitives * (outlineSize + 4) : 0
    // Reserve before conversion, connectivity traversal, pad checks or polygon
    // scans. The added checks share the existing finite pool work allowance.
    this.charge(primitives * (primitives + obstaclePrimitives + outlineSize + 4) +
      padValidationWork + boardValidationWork)
    const { connectedRouteNamesByObstacle, connectedObstaclesByRoute } = getObstacleRouteConnectivity({
      obstacles: this.obstacles, routes: [route], connMap: params.connMap,
    })
    const srj: SimpleRouteJson = {
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      minViaDiameter: params.viaDiameter,
      minViaHoleDiameter: params.viaHoleDiameter,
      minViaEdgeToPadEdgeClearance: params.viaToPadClearance,
      allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      bounds,
      ...params.boardGeometry,
      obstacles: this.obstacles.map((obstacle, index) => ({
        ...obstacle, connectedTo: [...obstacle.connectedTo, ...connectedRouteNamesByObstacle[index]!],
      })),
      connections: [{
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        __netConnectionName: route.rootConnectionName ?? route.connectionName,
        pointsToConnect: [start, end].map((point) => ({ ...point, layer: mapZToLayerName(point.z, params.layerCount) })).concat(
          connectedObstaclesByRoute[0]!.filter((obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id).map((obstacle) => ({
            ...obstacle.center, z: 0, layer: mapZToLayerName(0, params.layerCount), pcb_port_id: obstacle.circuitJsonMetadata!.pcb_port_id,
          })),
        ),
      }],
    }
    const traceId = `column_${route.connectionName}`
    const circuitJson = convertToCircuitJson(srj, [{
      type: "pcb_trace", pcb_trace_id: traceId,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, params.layerCount, { defaultViaHoleDiameter: params.viaHoleDiameter }),
    }])
    if (params.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
    if (route.vias.length > 0 && this.obstacles.length > 0) {
      const drcConnectivity = getFullConnectivityMapFromCircuitJson(circuitJson)
      const padIds = new Set<string>()
      for (const element of circuitJson) {
        if (element.type === "pcb_via" && "pcb_trace_id" in element && typeof element.pcb_trace_id === "string")
          drcConnectivity.addConnections([[element.pcb_via_id, element.pcb_trace_id]])
        if (element.type === "pcb_smtpad") padIds.add(element.pcb_smtpad_id)
        if (element.type === "pcb_plated_hole") padIds.add(element.pcb_plated_hole_id)
      }
      // Mesh ports do not necessarily touch a component pad. Preserve the
      // imported physical ownership even when no PCB port can be attached.
      // Distinct geometric pieces of one pad receive conversion fragment IDs.
      for (let index = 0; index < this.obstacles.length; index++) {
        const metadata = this.obstacles[index]!.circuitJsonMetadata
        const baseId = metadata?.pcb_plated_hole_id ?? metadata?.pcb_smtpad_id
        if (!baseId || connectedRouteNamesByObstacle[index]!.length === 0) continue
        for (const padId of [baseId, `${baseId}_fragment_${index}`]) {
          if (padIds.has(padId)) drcConnectivity.addConnections([[traceId, padId]])
        }
      }
      if (checkViaPadClearance(circuitJson, {
        connMap: drcConnectivity,
        minClearance: params.viaToPadClearance ?? params.obstacleMargin,
      }).length > 0) return this.rejectStatic("viaPad")
    }
    if (params.boardGeometry) {
      const inside = srj.outline
        ? route.route.every((point): boolean => isPointInsidePolygon(point, srj.outline!))
        : route.route.every((point): boolean => isPointInsideBounds(point, srj.bounds))
      if (!inside) return this.rejectStatic("boardContainment")
      // This check uses each converted via's actual copper diameter, complete
      // drill-layer span and the physical board's declared edge clearance.
      if (checkViasOffBoard(circuitJson).length > 0) return this.rejectStatic("viaBoard")
    }
    const { errors } = getDrcErrors(circuitJson, {
      traceClearance: params.obstacleMargin, viaClearance: params.obstacleMargin,
      holeClearance: params.minViaHoleEdgeToViaHoleEdgeClearance,
      includeTraceContinuity: false,
    })
    if (errors.length > 0) return this.rejectStatic(`boardDrc_${errors[0]!.type}`)
    const fixedViolations = getFixedObstacleViolations({
      srj: { ...srj, traces: undefined }, routes: [route],
      traceClearance: params.obstacleMargin, viaClearance: params.obstacleMargin,
    })
    return fixedViolations.length === 0 || this.rejectStatic("fixedCopper")
  }

  private compatible(left: Column, right: Column, sameOwner: boolean): boolean {
    const key = left.id < right.id ? `${left.id}:${right.id}` : `${right.id}:${left.id}`
    this.charge(1)
    const cached = this.pairCompatibility.get(key)
    if (cached !== undefined) return cached
    const { params } = this
    const drillGap = (params.viaHoleDiameter ?? params.viaDiameter) +
      (params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1)
    let valid = true
    for (const a of left.route.vias) for (const b of right.route.vias) {
      this.charge(1)
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (distance < drillGap && !(sameOwner && distance < 1e-8)) valid = false
    }
    if (valid && !sameOwner) {
      this.charge(left.route.route.length + left.route.vias.length + right.route.route.length + right.route.vias.length)
      const a = getPipeline9RouteCopperGeometry(left.route, params)
      const b = getPipeline9RouteCopperGeometry(right.route, params)
      this.charge((a.wireSegments.length + a.viaSpans.length) * (b.wireSegments.length + b.viaSpans.length))
      valid = !doPipeline9RoutesHaveCopperConflict({
        left: left.route, right: right.route, clearance: params.obstacleMargin, ...params,
      })
    }
    this.pairCompatibility.set(key, valid)
    this.record("routeColumnPairChecks")
    return valid
  }

  private selectCompatibleColumns(): void {
    this.charge(this.tasks.length)
    if (this.tasks.some((task) => task.columns.length === 0)) return
    this.record("routeColumnSelectionAttempts")
    const order = [...this.tasks].sort((a, b) => {
      this.charge(1)
      return a.columns.length - b.columns.length || this.tasks.indexOf(a) - this.tasks.indexOf(b)
    })
    const selected: { task: Task; column: Column }[] = []
    const search = (depth: number): boolean => {
      this.charge(1)
      if (depth === order.length) return true
      const task = order[depth]!
      for (const column of task.columns) {
        this.charge(1)
        if (selected.some((prior) => !this.compatible(column, prior.column, task.owner === prior.task.owner))) continue
        selected.push({ task, column })
        if (search(depth + 1)) return true
        selected.pop()
      }
      return false
    }
    if (!search(0)) {
      this.record("routeColumnFinitePoolUnknown")
      return
    }
    this.charge(this.tasks.length)
    this.solvedRoutes = this.tasks.map((task) => selected.find((entry) => entry.task === task)!.column.route)
    this.record("routeColumnSolvedNodes")
    this.record("routeColumnCrossDonorSolutions", Number(new Set(selected.map((entry) => entry.column.donor)).size > 1))
  }
}
