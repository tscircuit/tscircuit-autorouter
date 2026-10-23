import { BaseSolver } from "../../solvers/BaseSolver"
import type { NodeWithPortPoints, PortPoint } from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import type { UniformPortDistributionSolver } from "../../solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "../../solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { SharedEdge } from "../../solvers/UniformPortDistributionSolver/types"
import { getOwnerPairKey, normalizeOwnerPair } from "../../solvers/UniformPortDistributionSolver/getOwnerPairKey"
import { precomputeSharedEdges } from "../../solvers/UniformPortDistributionSolver/precomputeSharedEdges"
import { mapLayerNameToZ } from "../../utils/mapLayerNameToZ"

type Interval = { min: number; max: number }
type Lane = { id: string; preferred: number; fixed: boolean }
export type BoundaryLaneContract = {
  ownerNodeIds: [string, string]
  z: number
  orientation: "horizontal" | "vertical"
  coordinate: number
  lanes: Array<{ portPointId: string; center: number; min: number; max: number }>
}

/** Ordered interval allocation is complete for this one-dimensional aperture model. */
export function allocateBoundaryLanes(
  lanes: Lane[],
  apertures: Interval[],
  pitch: number,
): number[] | null {
  if (!Number.isFinite(pitch) || pitch < 0 || lanes.some((lane) => !Number.isFinite(lane.preferred)) || apertures.some((a) => !Number.isFinite(a.min) || !Number.isFinite(a.max) || a.min > a.max)) throw new Error("Boundary lane allocation requires finite ordered geometry")
  const earliest: number[] = []
  for (let i = 0; i < lanes.length; i++) {
    const lower = i === 0 ? -Infinity : earliest[i - 1]! + pitch
    const lane = lanes[i]!
    const interval = apertures.find((a) =>
      lane.fixed
        ? lane.preferred >= Math.max(a.min, lower) && lane.preferred <= a.max
        : Math.max(a.min, lower) <= a.max,
    )
    if (!interval) return null
    earliest.push(lane.fixed ? lane.preferred : Math.max(interval.min, lower))
  }
  const latest = Array<number>(lanes.length)
  for (let i = lanes.length - 1; i >= 0; i--) {
    const upper = i === lanes.length - 1 ? Infinity : latest[i + 1]! - pitch
    const lane = lanes[i]!
    const interval = [...apertures].reverse().find((a) =>
      lane.fixed
        ? lane.preferred >= a.min && lane.preferred <= Math.min(a.max, upper)
        : a.min <= Math.min(a.max, upper),
    )
    if (!interval) return null
    latest[i] = lane.fixed ? lane.preferred : Math.min(interval.max, upper)
  }
  const positions: number[] = []
  for (let i = 0; i < lanes.length; i++) {
    const lower = Math.max(earliest[i]!, i === 0 ? -Infinity : positions[i - 1]! + pitch)
    const upper = latest[i]!
    let selected: number | undefined
    for (const aperture of apertures) {
      const min = Math.max(lower, aperture.min)
      const max = Math.min(upper, aperture.max)
      if (min > max) continue
      const candidate = Math.max(min, Math.min(max, lanes[i]!.preferred))
      if (selected === undefined || Math.abs(candidate - lanes[i]!.preferred) < Math.abs(selected - lanes[i]!.preferred)) {
        selected = candidate
      }
    }
    if (selected === undefined) throw new Error("Boundary contract projection lost a feasible ordered aperture")
    positions.push(selected)
  }
  return positions
}

type Input = {
  distribution: UniformPortDistributionSolver
  obstacles: Obstacle[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  layerCount: number
  traceWidth: number
  clearance: number
  hasPreloadedCopper: boolean
}

/** A constructive boundary contract, not a claim of whole-cell routability. */
export class Pipeline9BoundaryContractSolver extends BaseSolver {
  readonly contracts: BoundaryLaneContract[] = []
  private readonly nodes: NodeWithPortPoints[]
  private readonly edges: SharedEdge[]
  private readonly actualPorts: Map<string, PortPoint>
  private readonly fixedPortIds = new Set<string>()
  private readonly portIdsByEdge = new Map<string, Set<string>>()
  private readonly positions = new Map<string, { x: number; y: number }>()

  constructor(private readonly input: Input) {
    super()
    this.nodes = structuredClone(input.distribution.getOutput())
    if (!Number.isFinite(input.traceWidth) || !(input.traceWidth > 0) || !Number.isFinite(input.clearance) || input.clearance < 0 || !Number.isInteger(input.layerCount) || input.layerCount < 1) throw new Error("Boundary contract requires finite positive width, nonnegative clearance and valid layer count")
    for (const node of this.nodes) {
      if (![node.center.x, node.center.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || node.portPoints.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isInteger(p.z) || p.z < 0 || p.z >= input.layerCount)) throw new Error(`Boundary contract has invalid node geometry: ${node.capacityMeshNodeId}`)
    }
    for (const obstacle of input.obstacles) {
      const zs = obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount))
      if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0 || zs.some((z) => !Number.isInteger(z) || z < 0 || z >= input.layerCount)) throw new Error("Boundary contract has invalid obstacle geometry")
    }
    this.actualPorts = new Map(this.nodes.flatMap((n) => n.portPoints.flatMap((p) => p.portPointId ? [[p.portPointId, p] as const] : [])))
    const targetNodeIds = new Set(input.inputNodesWithPortPoints.filter((n) => n._containsTarget).map((n) => n.capacityMeshNodeId))
    for (const node of input.inputNodesWithPortPoints) {
      for (const port of node.portPoints) {
        const edgeKey = getOwnerPairKey(normalizeOwnerPair(...port.connectionNodeIds))
        const ids = this.portIdsByEdge.get(edgeKey) ?? new Set<string>()
        if (this.actualPorts.has(port.portPointId)) ids.add(port.portPointId)
        this.portIdsByEdge.set(edgeKey, ids)
        if (targetNodeIds.has(node.capacityMeshNodeId) || port.connectionNodeIds.some((id) => targetNodeIds.has(id))) this.fixedPortIds.add(port.portPointId)
      }
    }
    this.edges = [...precomputeSharedEdges({
      ownerPairs: [...input.distribution.mapOfOwnerPairToSharedEdge.values()].map((e) => e.ownerNodeIds),
      nodeBounds: new Map(this.nodes.map((n) => [n.capacityMeshNodeId, { minX: n.center.x - n.width / 2, maxX: n.center.x + n.width / 2, minY: n.center.y - n.height / 2, maxY: n.center.y + n.height / 2 }])),
    }).values()]
    this.MAX_ITERATIONS = this.edges.length + 1
    this.stats = { certifiedBoundaries: 0, uncertifiedBoundaries: 0, movedPortPoints: 0 }
  }

  override _step(): void {
    const edge = this.edges.pop()
    if (!edge) {
      for (const node of this.nodes) {
        const update = (p: PortPoint): PortPoint => {
          const position = p.portPointId ? this.positions.get(p.portPointId) : undefined
          return position ? { ...p, ...position } : p
        }
        node.portPoints = node.portPoints.map(update)
        node.portPointsInPairs = node.portPointsInPairs?.map(([a, b]) => [update(a), update(b)])
      }
      this.solved = true
      return
    }
    const family = this.portIdsByEdge.get(edge.ownerPairKey)
    if (!family) throw new Error(`Boundary contract has no port family for ${edge.ownerPairKey}`)
    const byLayer = new Map<number, PortPoint[]>()
    for (const id of family) {
      const port = this.actualPorts.get(id)
      if (!port) throw new Error(`Boundary contract lost port ${id}`)
      const ports = byLayer.get(port.z) ?? []
      ports.push(port)
      byLayer.set(port.z, ports)
    }
    const horizontal = edge.orientation === "horizontal"
    const coordinate = horizontal ? edge.y1 : edge.x1
    const radius = this.input.traceWidth / 2
    const pitch = this.input.traceWidth + this.input.clearance
    for (const [z, ports] of byLayer) {
      let apertures: Interval[] = [{ min: (horizontal ? edge.x1 : edge.y1) + pitch, max: (horizontal ? edge.x2 : edge.y2) - pitch }].filter((a) => a.min <= a.max)
      for (const obstacle of this.input.obstacles) {
        const zs = obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, this.input.layerCount))
        if (!zs.includes(z)) continue
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const halfX = Math.abs(Math.cos(angle)) * obstacle.width / 2 + Math.abs(Math.sin(angle)) * obstacle.height / 2 + radius + this.input.clearance
        const halfY = Math.abs(Math.sin(angle)) * obstacle.width / 2 + Math.abs(Math.cos(angle)) * obstacle.height / 2 + radius + this.input.clearance
        if (Math.abs(coordinate - (horizontal ? obstacle.center.y : obstacle.center.x)) > (horizontal ? halfY : halfX)) continue
        const blockedMin = (horizontal ? obstacle.center.x - halfX : obstacle.center.y - halfY) - 1e-7
        const blockedMax = (horizontal ? obstacle.center.x + halfX : obstacle.center.y + halfY) + 1e-7
        apertures = apertures.flatMap((a) => blockedMax < a.min || blockedMin > a.max ? [a] : [
          ...(a.min < blockedMin ? [{ min: a.min, max: blockedMin }] : []),
          ...(blockedMax < a.max ? [{ min: blockedMax, max: a.max }] : []),
        ])
      }
      ports.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y) || a.portPointId!.localeCompare(b.portPointId!))
      const lanes = ports.map((p) => ({
        id: p.portPointId!,
        preferred: horizontal ? p.x : p.y,
        // Preloaded attachment positions and terminal escape points are immutable.
        fixed: this.input.hasPreloadedCopper || Boolean(p.pcb_port_id) || this.fixedPortIds.has(p.portPointId!),
      }))
      const allocated = allocateBoundaryLanes(lanes, apertures, pitch)
      if (!allocated) {
        // The conservative AABB aperture model is inconclusive, not an unsat proof.
        this.stats.uncertifiedBoundaries++
        continue
      }
      this.contracts.push({ ownerNodeIds: edge.ownerNodeIds, z, orientation: edge.orientation, coordinate, lanes: lanes.map((lane, i) => ({ portPointId: lane.id, center: allocated[i]!, min: allocated[i]! - radius, max: allocated[i]! + radius })) })
      this.stats.certifiedBoundaries++
      for (let i = 0; i < lanes.length; i++) {
        if (allocated[i] !== lanes[i]!.preferred) this.stats.movedPortPoints++
        this.positions.set(lanes[i]!.id, horizontal ? { x: allocated[i]!, y: coordinate } : { x: coordinate, y: allocated[i]! })
      }
    }
  }

  getOutput(): NodeWithPortPoints[] {
    if (!this.solved) throw new Error("Boundary contract output requested before completion")
    return this.nodes
  }
}
