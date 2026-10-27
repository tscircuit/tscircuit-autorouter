import { pointToBoxDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { indexPortPointOwnerNodes } from "lib/solvers/UniformPortDistributionSolver/determineOwnerPair"
import { getConnectionPointLayers, type CapacityMeshNode, type Obstacle, type SimpleRouteConnection, type SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type Position = { x: number; y: number }
type ComponentArea = { componentId: string; bounds: SimpleRouteJson["bounds"] }
type PortalFamily = {
  keys: string[]
  slots: Position[]
  nodeIds: [string, string]
  componentId: string
  exterior: boolean
  orders: number[][]
  z: number
}
type Score = { crossings: number; length: number }
export type JointComponentEscapePlannerInput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  capacityNodes: CapacityMeshNode[]
  componentAreas: ComponentArea[]
  connections: SimpleRouteConnection[]
  physicalConnections?: SimpleRouteConnection[]
  obstacles: Obstacle[]
  layerCount: number
  traceWidth: number
  obstacleMargin: number
  traceClearance: number
  padClearance: number
  traceToHoleClearance?: number
  connectivityNetMap?: Record<string, string[]>
  enabled?: boolean
}

const EPSILON = 1e-7
const MAX_FAMILIES_PER_BUNDLE = 8
const MAX_PERMUTED_PORTS = 8

/**
 * Chooses component exit orders together with the intervening area order.
 * A candidate permutes existing same-layer slots; terminals, layers and route
 * incidence stay fixed. The score is a topology proxy, not a DRC certificate.
 * Detailed routing and the existing physical validators still realize copper.
 */
export class JointComponentEscapePlannerSolver extends BaseSolver {
  private readonly positions = new Map<string, Position>()
  private readonly nodeById: Map<string, NodeWithPortPoints>
  private readonly netById = new Map<string, string>()
  private readonly widthByConnection = new Map<string, number>()
  readonly blockedPortalSamples: Array<{ reason: string; actual: number; required: number; nodeIds: string[]; obstacleId?: string }> = []
  private output: NodeWithPortPoints[]
  override stats = {
    componentPairBundleCount: 0,
    sourcePackageExternalBundleCount: 0,
    eligiblePortalFamilyCount: 0,
    internalEscapePortalFamilyCount: 0,
    exteriorEscapePortalFamilyCount: 0,
    candidateAssignmentsEvaluated: 0,
    optimizedComponentPairBundleCount: 0,
    reorderedPortalCount: 0,
    jointlyReorderedFamilyPairs: 0,
    predictedCrossingsBefore: 0,
    predictedCrossingsAfter: 0,
    skippedOversizePortalFamilyCount: 0,
    skippedBlockedPortalFamilyCount: 0,
    truncatedBundleCount: 0,
    scoreSegmentVisits: 0,
    scoreSegmentPairTests: 0,
    slotObstacleTests: 0,
    slotNeighborTests: 0,
    protectedPhysicalTerminalCount: 0,
    rejectedSlotOrders: 0,
    rejectedContactAssignments: 0,
  }

  constructor(private readonly input: JointComponentEscapePlannerInput) {
    super()
    this.output = input.nodesWithPortPoints
    this.nodeById = new Map(input.nodesWithPortPoints.map((node) => [node.capacityMeshNodeId, node]))
    for (const [net, ids] of Object.entries(input.connectivityNetMap ?? {})) {
      for (const id of ids) this.netById.set(id, net)
    }
    for (const connection of input.connections) {
      this.widthByConnection.set(connection.name, Math.max(input.traceWidth, connection.nominalTraceWidth ?? input.traceWidth))
    }
    if (![input.traceClearance, input.padClearance].every((gap) => Number.isFinite(gap) && gap >= 0)) throw new Error("Joint escape planner requires finite nonnegative physical clearances")
    for (const node of input.nodesWithPortPoints) {
      for (const point of node.portPoints) {
        this.positions.set(this.pointKey(point), { x: point.x, y: point.y })
      }
    }
  }

  private pointKey(point: PortPoint): string {
    // Ports can be shared by different routes in an abstract hypergraph. Net
    // identity is therefore part of the key; all copies of one assignment move.
    return JSON.stringify([point.connectionName, point.portPointId ?? [point.x, point.y], point.pcb_port_id ?? null, point.z])
  }

  private ownerKey(id: string): string {
    const net = this.netById.get(id)
    // A registered net's key is not itself an ownership alias unless it also
    // appears in that net's member list. Keep unknown literal IDs distinct.
    return net === undefined
      ? JSON.stringify(["literal", id])
      : JSON.stringify(["registered", net])
  }

  private componentAt(point: Position): string | undefined {
    const matches = this.input.componentAreas.filter(({ bounds }) =>
      point.x >= bounds.minX - EPSILON && point.x <= bounds.maxX + EPSILON &&
      point.y >= bounds.minY - EPSILON && point.y <= bounds.maxY + EPSILON,
    )
    // Overlapping component regions do not have a unique interface ownership.
    return matches.length === 1 ? matches[0]!.componentId : undefined
  }

  private collectFamilies(): PortalFamily[][] {
    const bundleByConnection = new Map<string, string>()
    for (const connection of this.input.connections) {
      if (connection.pointsToConnect.length !== 2) continue
      const first = this.componentAt(connection.pointsToConnect[0]!)
      const second = this.componentAt(connection.pointsToConnect[1]!)
      if (first && second && first !== second) {
        bundleByConnection.set(connection.name, JSON.stringify([first, second].sort()))
      } else if (Boolean(first) !== Boolean(second)) {
        // One supported package can have a whole bank of ordinary external
        // terminals. Its escape order must still agree with the adjacent area.
        bundleByConnection.set(connection.name, JSON.stringify([first ?? second!, "external-terminal-set"]))
      }
    }
    const componentByNode = new Map<string, string>()
    for (const node of this.input.capacityNodes) {
      if (!node._isComponentTopologyNode) continue
      const component = this.componentAt(node.center)
      if (component) componentByNode.set(node.capacityMeshNodeId, component)
    }
    const owners = indexPortPointOwnerNodes(this.input.inputNodesWithPortPoints)
    const groups = new Map<string, { bundle: string; family: PortalFamily; seen: Set<string> }>()
    for (const node of this.input.nodesWithPortPoints) {
      for (const point of node.portPoints) {
        const bundle = bundleByConnection.get(point.connectionName)
        const ownerPair = point.portPointId ? owners.get(point.portPointId) : undefined
        if (!bundle || !ownerPair || point.pcb_port_id) continue
        const physicalTerminal = [...this.input.connections, ...(this.input.physicalConnections ?? [])].some((connection) =>
          connection.pointsToConnect.some((terminal) =>
            Math.abs(point.x - terminal.x) <= EPSILON && Math.abs(point.y - terminal.y) <= EPSILON &&
            getConnectionPointLayers(terminal).some((layer) => mapLayerNameToZ(layer, this.input.layerCount) === point.z),
          ),
        )
        if (physicalTerminal) {
          this.stats.protectedPhysicalTerminalCount++
          continue
        }
        const firstComponent = componentByNode.get(ownerPair[0])
        const secondComponent = componentByNode.get(ownerPair[1])
        if (!firstComponent && !secondComponent) continue
        const componentId = firstComponent ?? secondComponent!
        if (!(JSON.parse(bundle) as string[]).includes(componentId)) continue
        const key = JSON.stringify([bundle, [...ownerPair].sort(), point.z])
        let group = groups.get(key)
        if (!group) {
          group = { bundle, family: { keys: [], slots: [], nodeIds: ownerPair, componentId, exterior: Boolean(firstComponent) !== Boolean(secondComponent), orders: [], z: point.z }, seen: new Set() }
          groups.set(key, group)
        }
        const pointKey = this.pointKey(point)
        if (group.seen.has(pointKey)) continue
        group.seen.add(pointKey)
        group.family.keys.push(pointKey)
        group.family.slots.push({ x: point.x, y: point.y })
      }
    }
    const bundles = new Map<string, PortalFamily[]>()
    for (const { bundle, family } of groups.values()) {
      if (family.keys.length < 2) continue
      if (family.keys.length > MAX_PERMUTED_PORTS) {
        this.stats.skippedOversizePortalFamilyCount++
        continue
      }
      family.orders = this.permutations(family.keys.length).filter((order) => this.isSafeSlotFamily(family, order))
      if (family.orders.length === 0 || (family.orders.length === 1 && family.orders[0]!.every((slot, index) => slot === index))) {
        this.stats.skippedBlockedPortalFamilyCount++
        continue
      }
      const existing = bundles.get(bundle) ?? []
      existing.push(family)
      bundles.set(bundle, existing)
      this.stats.eligiblePortalFamilyCount++
      if (family.exterior) this.stats.exteriorEscapePortalFamilyCount++
      else this.stats.internalEscapePortalFamilyCount++
    }
    this.stats.sourcePackageExternalBundleCount = [...bundles.keys()].filter((key) => key.includes('"external-terminal-set"')).length
    this.stats.componentPairBundleCount = bundles.size - this.stats.sourcePackageExternalBundleCount
    return [...bundles.values()]
  }

  private isSafeSlotFamily(family: PortalFamily, order: number[]): boolean {
    const points = family.keys.map((key) => JSON.parse(key) as [string, string, string | null])
    const widths = points.map(([name]) => this.widthByConnection.get(name)!)
    const references = this.nodeById.get(family.nodeIds[0])?.portPoints
    if (!references || !this.nodeById.has(family.nodeIds[1])) return false
    const firstPoint = references.find((point) => this.pointKey(point) === family.keys[0])
    if (!firstPoint) return false
    for (let i = 0; i < family.slots.length; i++) {
      const slot = family.slots[order[i]!]!
      const width = widths[i]!
      const owner = this.ownerKey(points[i]![0])
      for (let j = i + 1; j < family.slots.length; j++) {
        this.stats.slotNeighborTests++
        const otherOwner = this.ownerKey(points[j]![0])
        if (owner === otherOwner) continue
        const otherSlot = family.slots[order[j]!]!
        const required = (width + widths[j]!) / 2 + this.input.traceClearance
        const actual = Math.hypot(slot.x - otherSlot.x, slot.y - otherSlot.y)
        if (actual < required - EPSILON) return this.rejectOrder(family, "slot-spacing", actual, required)
      }
      for (const obstacle of this.input.obstacles) {
        const layers = obstacle.zLayers ?? obstacle.__zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, this.input.layerCount))
        if (!layers.includes(firstPoint.z)) continue
        this.stats.slotObstacleTests++
        if (!obstacle.isNonPlatedHole && obstacle.connectedTo.some((id) => this.ownerKey(id) === owner)) continue
        // A rotated bounding box is conservative for every net assigned here.
        const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const rectangle = { center: obstacle.center,
          width: Math.abs(Math.cos(angle)) * obstacle.width + Math.abs(Math.sin(angle)) * obstacle.height,
          height: Math.abs(Math.sin(angle)) * obstacle.width + Math.abs(Math.cos(angle)) * obstacle.height }
        const required = width / 2 + (obstacle.isNonPlatedHole ? (this.input.traceToHoleClearance ?? this.input.padClearance) : this.input.padClearance)
        const actual = pointToBoxDistance(slot, rectangle)
        if (actual < required - EPSILON) return this.rejectOrder(family, "pad-clearance", actual, required, obstacle.obstacleId)
      }
    }
    return true
  }

  private rejectOrder(family: PortalFamily, reason: string, actual: number, required: number, obstacleId?: string): false {
    this.stats.rejectedSlotOrders++
    if (this.blockedPortalSamples.length < 16) {
      this.blockedPortalSamples.push({ reason, actual, required, nodeIds: [...family.nodeIds], obstacleId })
    }
    return false
  }

  private hasSafeAssignedContacts(families: PortalFamily[]): boolean {
    // Check the complete proposed assignment, including changes made together
    // or by an earlier bundle. Single-family precomputation cannot certify it.
    for (const family of families) {
      for (const key of family.keys) {
        const [name] = JSON.parse(key) as [string]
        const owner = this.ownerKey(name)
        const width = this.widthByConnection.get(name)!
        const slot = this.positions.get(key)!
        for (const nodeId of family.nodeIds) {
          for (const neighbor of this.nodeById.get(nodeId)!.portPoints) {
            if (neighbor.z !== family.z || this.ownerKey(neighbor.connectionName) === owner) continue
            const neighborPosition = this.positions.get(this.pointKey(neighbor))!
            const neighborWidth = this.widthByConnection.get(neighbor.connectionName)
            if (neighborWidth === undefined) {
              this.stats.rejectedContactAssignments++
              return this.rejectOrder(family, "unknown-contact-width", 0, 0)
            }
            const required = (width + neighborWidth) / 2 + this.input.traceClearance
            const actual = Math.hypot(slot.x - neighborPosition.x, slot.y - neighborPosition.y)
            this.stats.slotNeighborTests++
            if (actual < required - EPSILON) {
              this.stats.rejectedContactAssignments++
              return this.rejectOrder(family, "neighbor-spacing", actual, required)
            }
          }
        }
      }
    }
    return true
  }

  private score(nodeIds: Set<string>): Score {
    let crossings = 0
    let length = 0
    for (const nodeId of nodeIds) {
      const node = this.nodeById.get(nodeId)!
      const pairs = node.portPointsInPairs
      if (!pairs) continue
      for (let i = 0; i < pairs.length; i++) {
        this.stats.scoreSegmentVisits++
        const [a, b] = pairs[i]!
        const aPos = this.positions.get(this.pointKey(a))!
        const bPos = this.positions.get(this.pointKey(b))!
        length += Math.hypot(aPos.x - bPos.x, aPos.y - bPos.y)
        if (a.z !== b.z) continue
        for (let j = i + 1; j < pairs.length; j++) {
          const [c, d] = pairs[j]!
          const leftOwner = this.ownerKey(a.connectionName)
          const rightOwner = this.ownerKey(c.connectionName)
          if (c.z !== d.z || a.z !== c.z || leftOwner === rightOwner) continue
          this.stats.scoreSegmentPairTests++
          const cPos = this.positions.get(this.pointKey(c))!
          const dPos = this.positions.get(this.pointKey(d))!
          const abC = (bPos.x - aPos.x) * (cPos.y - aPos.y) - (bPos.y - aPos.y) * (cPos.x - aPos.x)
          const abD = (bPos.x - aPos.x) * (dPos.y - aPos.y) - (bPos.y - aPos.y) * (dPos.x - aPos.x)
          const cdA = (dPos.x - cPos.x) * (aPos.y - cPos.y) - (dPos.y - cPos.y) * (aPos.x - cPos.x)
          const cdB = (dPos.x - cPos.x) * (bPos.y - cPos.y) - (dPos.y - cPos.y) * (bPos.x - cPos.x)
          if (abC * abD < -EPSILON && cdA * cdB < -EPSILON) crossings++
        }
      }
    }
    return { crossings, length }
  }

  private permutations(count: number): number[][] {
    const initial = Array.from({ length: count }, (_, index) => index)
    if (count > 4) {
      // A finite neighborhood for large exits, rather than factorial expansion.
      return [initial, [...initial].reverse(), ...initial.slice(1).map((_, index) => {
        const order = [...initial]
        ;[order[index], order[index + 1]] = [order[index + 1]!, order[index]!]
        return order
      })]
    }
    let orders: number[][] = [[]]
    for (const value of initial) {
      orders = orders.flatMap((order) => Array.from({ length: order.length + 1 }, (_, at) => [...order.slice(0, at), value, ...order.slice(at)]))
    }
    return [initial, ...orders.filter((order) => order.some((value, index) => value !== index))]
  }

  private optimizeBundle(allFamilies: PortalFamily[]): void {
    const ranked = allFamilies.map((family, index) => ({ family, index,
      pressure: this.score(new Set(family.nodeIds)).crossings,
    })).sort((left, right) => right.pressure - left.pressure || left.index - right.index)
    const families = ranked.slice(0, MAX_FAMILIES_PER_BUNDLE).map(({ family }) => family)
    if (families.length !== allFamilies.length) this.stats.truncatedBundleCount++
    const orders = families.map((family) => family.orders)
    const identities = families.map((family) => Array.from({ length: family.keys.length }, (_, index) => index))
    const nodeIds = new Set(families.flatMap((family) => family.nodeIds))
    const baseline = this.score(nodeIds)
    if (baseline.crossings === 0) return
    let best = baseline
    let bestAssignments: Array<[number, number[]]> = []
    const apply = (familyIndex: number, order: number[]): void => {
      const family = families[familyIndex]!
      for (let index = 0; index < family.keys.length; index++) this.positions.set(family.keys[index]!, family.slots[order[index]!]!)
    }
    for (let first = 0; first < families.length; first++) {
      for (let second = first; second < families.length; second++) {
        for (const firstOrder of orders[first]!) {
          apply(first, firstOrder)
          const secondOrders = first === second ? [orders[second]![0]!] : orders[second]!
          for (const secondOrder of secondOrders) {
            if (first !== second) apply(second, secondOrder)
            if (!this.hasSafeAssignedContacts(first === second ? [families[first]!] : [families[first]!, families[second]!])) continue
            const score = this.score(nodeIds)
            this.stats.candidateAssignmentsEvaluated++
            if (score.crossings < baseline.crossings && (score.crossings < best.crossings || (score.crossings === best.crossings && score.length < best.length - EPSILON))) {
              best = score
              bestAssignments = first === second ? [[first, firstOrder]] : [[first, firstOrder], [second, secondOrder]]
            }
          }
          if (first !== second) apply(second, identities[second]!)
        }
        apply(first, identities[first]!)
      }
    }
    if (bestAssignments.length === 0) return
    this.stats.optimizedComponentPairBundleCount++
    let changedFamilies = 0
    for (const [familyIndex, order] of bestAssignments) {
      apply(familyIndex, order)
      const changed = order.filter((slot, index) => slot !== index).length
      this.stats.reorderedPortalCount += changed
      if (changed > 0) changedFamilies++
    }
    if (changedFamilies === 2) this.stats.jointlyReorderedFamilyPairs++
  }

  override _step(): void {
    const allNodes = new Set(this.nodeById.keys())
    this.stats.predictedCrossingsBefore = this.score(allNodes).crossings
    if (this.input.enabled !== false) {
      for (const families of this.collectFamilies()) this.optimizeBundle(families)
      const move = (point: PortPoint): PortPoint => ({ ...point, ...this.positions.get(this.pointKey(point))! })
      this.output = this.input.nodesWithPortPoints.map((node) => ({ ...node,
        portPoints: node.portPoints.map(move),
        portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [move(start), move(end)]),
      }))
    }
    this.stats.predictedCrossingsAfter = this.score(allNodes).crossings
    this.solved = true
  }

  getOutput(): NodeWithPortPoints[] {
    if (!this.solved) throw new Error("Joint component escape planning has not completed")
    return this.output
  }

  override getConstructorParams(): [JointComponentEscapePlannerInput] {
    return [this.input]
  }
}
