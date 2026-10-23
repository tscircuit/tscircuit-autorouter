import Flatbush from "flatbush"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { Pipeline9BoundaryContractSolver, type BoundaryContractInput } from "./Pipeline9BoundaryContractSolver"
import { constructPipeline9ParametricCell } from "./constructPipeline9ParametricCell"
import { doPipeline9RoutesHaveCopperConflict, getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"
import { getCanonicalPipeline9PortRoot } from "./getCanonicalPipeline9PortRoot"
import type { Pipeline9ParametricInterfaceIndex } from "./Pipeline9ParametricInterfaceIndex"
import {
  getBoundaryFixedCopperKey, getBoundaryInterfaceKey, getBoundaryPhysicalRulesKey,
  indexBoundaryCopper, normalizeBoundaryNodeRoots,
  createBoundaryInterfaceIndex, getBoundaryInterfaceSceneKey,
  type BoundaryPhysicalRules, type BoundaryRouteCertificates,
} from "./boundaryRouteCertificates"

type Params = BoundaryContractInput & {
  connMap: ConnectivityMap
  rules: BoundaryPhysicalRules
  fixedHdRoutes: HighDensityRoute[]
  immutableConnectionNames: ReadonlySet<string>
}
type Move = { original: { x: number; y: number }; owners: Set<string> }

function getImmutablePortIds(params: Params): { ids: Set<string>; positions: Map<string, { x: number; y: number }>; restored: number } {
  const index = indexBoundaryCopper(params.fixedHdRoutes, params.rules.layerCount)
  const ids = new Set(params.immutablePortIds)
  const positions = new Map(params.immutablePortPositions)
  const restored = new Set<string>()
  const source = new Map<string, Params["inputNodesWithPortPoints"][number]["portPoints"][number]>()
  for (const node of params.inputNodesWithPortPoints) for (const point of node.portPoints) {
    const previous = source.get(point.portPointId)
    if (previous && (previous.x !== point.x || previous.y !== point.y || previous.z !== point.z)) throw new Error(`Boundary source port witnesses disagree: ${point.portPointId}`)
    source.set(point.portPointId, point)
  }
  for (const node of params.distribution.getOutput()) {
    for (const point of node.portPoints) {
      if (!point.portPointId) continue
      if (point.pcb_port_id || params.immutableConnectionNames.has(point.connectionName)) ids.add(point.portPointId)
      const original = source.get(point.portPointId) ?? point
      if (![original.x, original.y, original.z].every(Number.isFinite) || !Number.isInteger(original.z) || original.z < 0 || original.z >= params.layerCount) throw new Error(`Boundary attachment witness has invalid geometry: ${point.portPointId}`)
      for (const candidate of index?.search(original.x - 1e-7, original.y - 1e-7, original.x + 1e-7, original.y + 1e-7) ?? []) {
        const fixed = params.fixedHdRoutes[candidate]!
        const pointNet = getCanonicalPipeline9PortRoot(point, params.connMap)
        const fixedNet = getCanonicalPipeline9PortRoot(fixed, params.connMap)
        if (pointNet !== fixedNet) continue
        const copper = getPipeline9RouteCopperGeometry(fixed, params.rules)
        if (copper.wireSegments.some((segment) => segment.z === original.z && pointToSegmentDistance(original, segment.start, segment.end) <= segment.width / 2 + 1e-7) ||
          copper.viaSpans.some((via) => original.z >= via.minZ && original.z <= via.maxZ && Math.hypot(original.x - via.center.x, original.y - via.center.y) <= via.diameter / 2 + 1e-7)) {
          ids.add(point.portPointId)
          positions.set(point.portPointId, { x: original.x, y: original.y })
          if (original.x !== point.x || original.y !== point.y) restored.add(point.portPointId)
        }
      }
    }
  }
  return { ids, positions, restored: restored.size }
}

/** Keep a moved interface only with constructive physical proofs on both sides. */
export class Pipeline9CertifiedBoundarySolver extends Pipeline9BoundaryContractSolver {
  private readonly params: Params
  private phase: "allocate" | "prove" | "done" = "allocate"
  private output: NodeWithPortPoints[] = []
  private readonly originalNodes: NodeWithPortPoints[]
  private readonly moves = new Map<string, Move>()
  private readonly owners = new Map<string, Set<string>>()
  private readonly nodeById = new Map<string, NodeWithPortPoints>()
  private readonly pending: string[] = []
  private readonly queued = new Set<string>()
  private nodeIndex?: Flatbush
  private readonly fixedIndex?: Flatbush
  private readonly restoredAttachments: number
  private interfaceIndex?: Pipeline9ParametricInterfaceIndex
  readonly certificates: BoundaryRouteCertificates

  constructor(params: Params) {
    const immutable = getImmutablePortIds(params)
    super({ ...params, clearance: params.clearance + 2e-6, hasPreloadedCopper: false, immutablePortIds: immutable.ids, immutablePortPositions: immutable.positions })
    this.params = params
    this.originalNodes = structuredClone(this.nodes)
    this.restoredAttachments = immutable.restored
    this.fixedIndex = indexBoundaryCopper(params.fixedHdRoutes, params.rules.layerCount)
    this.certificates = { context: { rulesKey: getBoundaryPhysicalRulesKey(params.rules), fixedCopperKey: getBoundaryFixedCopperKey(params.fixedHdRoutes), interfaceSceneKey: "" }, cells: {} }
    // Allocation uses a conservative common lane width; physical proofs retain
    // each demand's declared width, including mutable preloaded sections.
    const physicalWidths = [params.rules.traceWidth, ...Object.values(params.rules.traceWidthByConnection ?? {})]
    if (params.layerCount !== params.rules.layerCount || physicalWidths.some((width) => !Number.isFinite(width) || width <= 0) || params.traceWidth < Math.max(...physicalWidths) || !Number.isFinite(params.rules.obstacleMargin) || params.rules.obstacleMargin < 0 || params.clearance < params.rules.obstacleMargin) throw new Error("Boundary allocation and physical proof rules disagree")
  }

  private enqueue(nodeId: string): void {
    if (!this.nodeById.has(nodeId)) throw new Error(`Boundary proof lost owner cell ${nodeId}`)
    delete this.certificates.cells[nodeId]
    if (!this.queued.has(nodeId)) {
      this.queued.add(nodeId)
      this.pending.push(nodeId)
    }
  }

  private initializeProofs(): void {
    this.output = structuredClone(super.getOutput())
    const original = new Map<string, PortPoint>()
    for (const node of this.originalNodes) for (const point of node.portPoints) {
      if (!point.portPointId) continue
      const previous = original.get(point.portPointId)
      if (previous && (previous.x !== point.x || previous.y !== point.y || previous.z !== point.z)) throw new Error(`Boundary original port copies disagree: ${point.portPointId}`)
      original.set(point.portPointId, point)
    }
    for (const node of this.output) {
      this.nodeById.set(node.capacityMeshNodeId, node)
      for (const point of node.portPoints) {
        if (!point.portPointId) continue
        const owners = this.owners.get(point.portPointId) ?? new Set<string>()
        owners.add(node.capacityMeshNodeId)
        this.owners.set(point.portPointId, owners)
      }
    }
    for (const node of this.output) for (const point of node.portPoints) {
      if (!point.portPointId) continue
      const before = original.get(point.portPointId)
      if (!before) throw new Error(`Boundary proof lost original port ${point.portPointId}`)
      if (before.x !== point.x || before.y !== point.y) this.moves.set(point.portPointId, { original: { x: before.x, y: before.y }, owners: this.owners.get(point.portPointId)! })
    }
    this.stats = { ...this.stats, boundaryProofAttempts: 0, boundaryProofAcceptedVersions: 0, boundaryProofUnsupported: 0,
      boundaryProofCopperChecks: 0, boundaryProofRollbacks: 0, boundaryProofMovedPorts: this.moves.size,
      boundaryProofRetainedMovedPorts: 0, boundaryProofCellCount: 0, boundaryProofRouteCount: 0,
      boundaryProofSceneVersions: 0, boundaryProofReservationBuildRows: 0, boundaryProofReservationRowsScanned: 0,
      boundaryProofReservationRowsRetained: 0, boundaryProofPeakReservationRows: 0, boundaryProofPeakReservationKeyCodeUnits: 0,
      boundaryProofDependencyQueries: 0, boundaryProofDependencyCandidates: 0, boundaryProofInvalidatedCertificates: 0 }
    this.stats.boundaryProofRestoredAttachments = this.restoredAttachments
    if (this.output.length > 0) {
      this.nodeIndex = new Flatbush(this.output.length)
      for (const node of this.output) this.nodeIndex.add(node.center.x - node.width / 2, node.center.y - node.height / 2, node.center.x + node.width / 2, node.center.y + node.height / 2)
      this.nodeIndex.finish()
    }
    this.rebuildReservations()
    for (const move of this.moves.values()) for (const owner of move.owners) this.enqueue(owner)
    // Each rollback removes at least one live move. In every resulting scene
    // the deduplicated queue can contain at most every cell once. This bounds
    // proof maintenance, without changing any detailed routing search budget.
    this.MAX_ITERATIONS = this.iterations + (this.moves.size + 1) * (this.output.length + 1) + 4
    this.solved = false
    this.phase = "prove"
  }

  private rebuildReservations(): void {
    this.interfaceIndex = createBoundaryInterfaceIndex(this.output, this.params.rules, this.params.connMap)
    this.stats.boundaryProofSceneVersions++
    this.stats.boundaryProofReservationBuildRows += this.interfaceIndex.ports.length
    this.stats.boundaryProofPeakReservationRows = Math.max(this.stats.boundaryProofPeakReservationRows, this.interfaceIndex.ports.length)
    this.stats.boundaryProofPeakReservationKeyCodeUnits = Math.max(this.stats.boundaryProofPeakReservationKeyCodeUnits, this.interfaceIndex.retainedKeyCodeUnits)
  }

  private rollback(nodeIds: ReadonlySet<string>): void {
    const restore = new Map<string, { x: number; y: number }>()
    const changedOwners = new Set<string>()
    const changedPositions: Array<{ x: number; y: number }> = []
    for (const [id, move] of this.moves) {
      if (![...move.owners].some((owner) => nodeIds.has(owner))) continue
      restore.set(id, move.original)
      const current = this.nodeById.get([...move.owners][0]!)!.portPoints.find((point) => point.portPointId === id)
      if (!current) throw new Error(`Boundary rollback lost current terminal ${id}`)
      changedPositions.push({ x: current.x, y: current.y }, move.original)
      for (const owner of move.owners) changedOwners.add(owner)
      this.moves.delete(id)
      this.stats.boundaryProofRollbacks++
    }
    for (const owner of changedOwners) {
      const node = this.nodeById.get(owner)!
      const update = (point: PortPoint): PortPoint => point.portPointId && restore.has(point.portPointId) ? { ...point, ...restore.get(point.portPointId)! } : point
      node.portPoints = node.portPoints.map(update)
      node.portPointsInPairs = node.portPointsInPairs?.map(([a, b]) => [update(a), update(b)])
    }
    if (restore.size === 0) return
    this.rebuildReservations()
    const maximumWidth = Math.max(this.params.rules.traceWidth, ...Object.values(this.params.rules.traceWidthByConnection ?? {}))
    const reach = Math.max(maximumWidth, this.params.rules.viaDiameter) / 2 + maximumWidth / 2 + Math.max(this.params.rules.obstacleMargin, 0.1) + 1e-6 + 1e-9
    const affected = new Set(changedOwners)
    for (const point of changedPositions) {
      this.stats.boundaryProofDependencyQueries++
      for (const index of this.nodeIndex?.search(point.x - reach, point.y - reach, point.x + reach, point.y + reach) ?? []) {
        this.stats.boundaryProofDependencyCandidates++
        const id = this.output[index]!.capacityMeshNodeId
        if (this.certificates.cells[id]) affected.add(id)
      }
    }
    // A certified centerline is contained in its cell. Beyond this expanded
    // old/new terminal influence, its exact reservation predicates cannot
    // change. Pending cells always use the freshly rebuilt complete scene.
    for (const owner of affected) {
      if (this.certificates.cells[owner]) this.stats.boundaryProofInvalidatedCertificates++
      this.enqueue(owner)
    }
  }

  private copperConflict(route: HighDensityRoute, other: HighDensityRoute): boolean {
    this.stats.boundaryProofCopperChecks++
    const clearance = Math.max(this.params.rules.obstacleMargin, 0.1) + 1e-6
    const left = getPipeline9RouteCopperGeometry(route, this.params.rules)
    const right = getPipeline9RouteCopperGeometry(other, this.params.rules)
    if (left.viaSpans.some((a) => right.viaSpans.some((b) => (a.center.x !== b.center.x || a.center.y !== b.center.y) && Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < a.diameter / 2 + b.diameter / 2 + clearance))) return true
    const owner = (candidate: HighDensityRoute): string => getCanonicalPipeline9PortRoot(candidate, this.params.connMap)
    if (owner(route) === owner(other)) return false
    return doPipeline9RoutesHaveCopperConflict({ left: route, right: other, clearance, layerCount: this.params.rules.layerCount, allowBlindAndBuriedVias: this.params.rules.allowBlindAndBuriedVias })
  }

  override _step(): void {
    if (this.phase === "allocate") {
      super._step()
      if (this.solved) this.initializeProofs()
      return
    }
    if (this.phase === "done") throw new Error("Certified boundary solver stepped after completion")
    const nodeId = this.pending.pop()
    if (!nodeId) {
      for (const move of this.moves.values()) if ([...move.owners].some((owner) => !this.certificates.cells[owner])) throw new Error("Moved boundary lacks a physical proof on every owner")
      const current = new Map(this.output.flatMap((node) => node.portPoints.flatMap((point) => point.portPointId ? [[point.portPointId, point] as const] : [])))
      for (const contract of this.contracts) for (const lane of contract.lanes) {
        const point = current.get(lane.portPointId)!
        const center = contract.orientation === "horizontal" ? point.x : point.y
        const radius = (lane.max - lane.min) / 2
        lane.center = center; lane.min = center - radius; lane.max = center + radius
      }
      this.stats.boundaryProofRetainedMovedPorts = this.moves.size
      this.stats.boundaryProofCellCount = Object.keys(this.certificates.cells).length
      this.stats.boundaryProofRouteCount = Object.values(this.certificates.cells).reduce((sum, cell) => sum + cell.routes.length, 0)
      if (!this.interfaceIndex) throw new Error("Boundary proof lost its final reservation scene")
      this.certificates.context.interfaceSceneKey = getBoundaryInterfaceSceneKey(this.interfaceIndex.ports)
      this.phase = "done"
      this.solved = true
      return
    }
    this.queued.delete(nodeId)
    const node = this.nodeById.get(nodeId)!
    this.stats.boundaryProofAttempts++
    if (!this.interfaceIndex) throw new Error("Boundary proof has no current reservation scene")
    const radius = Math.max(this.params.rules.traceWidth, this.params.rules.viaDiameter, ...Object.values(this.params.rules.traceWidthByConnection ?? {})) / 2
    const reservations = this.interfaceIndex.query(node, radius, Math.max(this.params.rules.obstacleMargin, 0.1))
    this.stats.boundaryProofReservationRowsScanned += this.interfaceIndex.ports.length
    this.stats.boundaryProofReservationRowsRetained += reservations.length
    const construction = constructPipeline9ParametricCell({ ...this.params.rules, node: normalizeBoundaryNodeRoots(node, this.params.connMap), connMap: this.params.connMap,
      interfacePolicy: "owned-normal-escapes", interfacePortPoints: reservations })
    for (const [key, value] of Object.entries(construction.stats)) this.stats[key] = Number(this.stats[key] ?? 0) + value
    if (!construction.applicable || construction.routes.length === 0) {
      this.stats.boundaryProofUnsupported++
      this.rollback(new Set([nodeId]))
      return
    }
    // The cell index encloses centerlines. Expand by both incident copper
    // radii, using every declared nominal width, before the exact predicate.
    const margin = this.params.rules.obstacleMargin + Math.max(this.params.traceWidth, this.params.rules.viaDiameter, ...Object.values(this.params.rules.traceWidthByConnection ?? {}))
    const bounds = [node.center.x - node.width / 2 - margin, node.center.y - node.height / 2 - margin, node.center.x + node.width / 2 + margin, node.center.y + node.height / 2 + margin] as const
    const fixed = (this.fixedIndex?.search(...bounds) ?? []).map((index) => this.params.fixedHdRoutes[index]!)
    const conflictingCells = new Set<string>()
    let fixedConflict = false
    for (const route of construction.routes) {
      if (fixed.some((other) => this.copperConflict(route, other))) fixedConflict = true
      for (const index of this.nodeIndex?.search(...bounds) ?? []) {
        const otherId = this.output[index]!.capacityMeshNodeId
        if (otherId === nodeId) continue
        const certificate = this.certificates.cells[otherId]
        if (certificate?.routes.some((other) => this.copperConflict(route, other))) conflictingCells.add(otherId)
      }
    }
    if (fixedConflict || conflictingCells.size > 0) {
      this.stats.boundaryProofUnsupported++
      conflictingCells.add(nodeId)
      this.rollback(conflictingCells)
      return
    }
    this.certificates.cells[nodeId] = { interfaceKey: getBoundaryInterfaceKey(node, this.params.connMap), routeKey: JSON.stringify(construction.routes), routes: construction.routes }
    this.stats.boundaryProofAcceptedVersions++
  }

  override getOutput(): NodeWithPortPoints[] {
    if (!this.solved || this.phase !== "done") throw new Error("Certified boundary output requested before proof completion")
    return this.output
  }
}
