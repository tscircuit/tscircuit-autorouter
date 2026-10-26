import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { EdgeInterval } from "./getSharedEdgePhysicalIntervals"
import { getOrderedSharedEdgeSchedule } from "./getOrderedSharedEdgeSchedule"
import {
  PhysicalSharedEdgePlacement,
  TRACE_ENGINE_TOLERANCE,
} from "./PhysicalSharedEdgePlacement"
import type {
  CoupledPortPlacementConstraint,
  CoupledPortPlacementInput,
  CoupledPortPlacementVariable,
} from "./CoupledPortPlacementSolver"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

export type MovableSharedEdgeFamily = { edge: SharedEdge; ports: PortPointWithOwnerPair[]; movablePortIds: readonly string[] }
type Event = {
  port: PortPoint
  owner: string | undefined
  width: number
  family?: string
  variable: CoupledPortPlacementVariable
}
export type CoupledSharedEdgeJob = { input: CoupledPortPlacementInput; indices: number[] }
type Input = {
  nodes: NodeWithPortPoints[]
  currentPorts: PortPointWithOwnerPair[]
  families: MovableSharedEdgeFamily[]
  physical: PhysicalSharedEdgePlacement
}
type Point = { x: number; y: number }

/** Builds one shared-coordinate problem and publishes only a fully checked result. */
export class CoupledSharedEdgePlacementPlan {
  readonly jobs: CoupledSharedEdgeJob[] = []
  private readonly events: Event[] = []
  private readonly named = new Map<string, number>()
  private readonly selected: number[] = []
  private readonly orders: CoupledPortPlacementConstraint[] = []
  private readonly anchorOrders: { first: number; second: number; axis: "x" | "y" }[] = []
  private readonly distances: CoupledPortPlacementConstraint[] = []
  private readonly physical: PhysicalSharedEdgePlacement

  constructor({ nodes, currentPorts, families, physical }: Input) {
    this.physical = physical
    for (const port of currentPorts) {
      if (!port.portPointId) throw new Error("A named shared-edge port has no identity")
      const existing = this.named.get(port.portPointId)
      if (existing !== undefined) {
        const previous = this.events[existing]!
        if (previous.owner !== physical.getOwner(port) || previous.port.z !== port.z ||
          previous.port.x !== port.x || previous.port.y !== port.y)
          throw new Error(`Conflicting copies of shared endpoint "${port.portPointId}"`)
        continue
      }
      this.named.set(port.portPointId, this.events.length)
      this.events.push({ port, owner: physical.getOwner(port), width: physical.getWidth(port),
        variable: { id: port.portPointId, x: port.x, y: port.y, dx: 0, dy: 0, domains: [[0, 0]], preferred: 0 } })
    }
    for (const { edge, ports, movablePortIds } of families) {
      const movable = new Set(movablePortIds)
      const layers = [...new Set(ports.map((port) => port.z))]
      for (const z of layers) {
        const dx = (edge.x2 - edge.x1) / edge.length, dy = (edge.y2 - edge.y1) / edge.length
        const ordered = ports.filter((port) => port.z === z).sort((a, b) =>
          (edge.orientation === "horizontal" ? a.x - b.x : a.y - b.y) ||
          (a.portPointId ?? "").localeCompare(b.portPointId ?? ""))
        const members: { index: number; movable: boolean; distance: number; allowed: EdgeInterval[] }[] = []
        for (const port of ordered) {
          const index = this.named.get(port.portPointId!)
          if (index === undefined) throw new Error("A shared-edge event disappeared")
          const event = this.events[index]!
          const distance = (port.x - edge.x1) * dx + (port.y - edge.y1) * dy
          const canMove = movable.has(port.portPointId!)
          if (!canMove) {
            const normalRoundoff = Math.min(event.width * 1e-6,
              Number.EPSILON * 8 * Math.max(1, Math.abs(port.x), Math.abs(port.y), Math.abs(edge.x1), Math.abs(edge.y1)))
            const onFace = edge.orientation === "horizontal"
              ? Math.abs(port.y - edge.y1) <= normalRoundoff && port.x >= Math.min(edge.x1, edge.x2) && port.x <= Math.max(edge.x1, edge.x2)
              : Math.abs(port.x - edge.x1) <= normalRoundoff && port.y >= Math.min(edge.y1, edge.y2) && port.y <= Math.max(edge.y1, edge.y2)
            // A fixed point outside the face keeps its real XY. Its projection
            // cannot establish a physical boundary order; distance still applies.
            if (!onFace) continue
            members.push({ index, movable: false, distance, allowed: [[distance, distance]] })
            continue
          }
          if (event.family !== undefined) throw new Error("A port has multiple movable faces")
          event.family = `${edge.ownerPairKey}:${z}`
          event.variable = { id: port.portPointId!, x: edge.x1, y: edge.y1, dx, dy,
            domains: physical.getAllowedIntervals(edge, { owner: event.owner, width: event.width, z }),
            preferred: (event.port.x - edge.x1) * dx + (event.port.y - edge.y1) * dy }
          members.push({ index, movable: true, distance, allowed: event.variable.domains })
        }
        const rules = { length: edge.length,
          ports: members.map((member) => {
            const event = this.events[member.index]!
            return { owner: event.owner, connectionName: event.port.connectionName, width: event.width, allowed: member.allowed }
          }), traceClearance: physical.traceClearance, tolerance: TRACE_ENGINE_TOLERANCE }
        const schedule = getOrderedSharedEdgeSchedule(rules)
        const roundoff = Number.EPSILON * 64 * Math.max(1, Math.abs(edge.x1), Math.abs(edge.y1), Math.abs(edge.x2), Math.abs(edge.y2), edge.length)
        const necessary = getOrderedSharedEdgeSchedule({ ...rules, proofSlack: roundoff })
        if (!necessary.feasible) throw new Error(`No ordered physical domain on shared edge "${edge.ownerPairKey}"`)
        for (let first = 0; first < members.length; first++) for (let second = first + 1; second < members.length; second++) {
          const a = members[first]!, b = members[second]!, gap = schedule.gaps[first]![second]!
          if (a.movable && b.movable) this.orders.push({ first: a.index, second: b.index, gap })
          else if (a.movable || b.movable) {
            this.anchorOrders.push({ first: a.index, second: b.index, axis: edge.orientation === "horizontal" ? "x" : "y" })
            const member = a.movable ? a : b, event = this.events[member.index]!
            const low = a.movable ? -Infinity : a.distance + gap - roundoff
            const high = a.movable ? b.distance - gap + roundoff : Infinity
            event.variable.domains = event.variable.domains.flatMap(([start, end]): EdgeInterval[] => {
              const min = Math.max(start, low), max = Math.min(end, high)
              return min <= max ? [[min, max]] : []
            })
          }
        }
      }
    }
    const pairs = new Set<string>()
    for (const node of nodes) {
      const indices = node.portPoints.map((port, pointIndex) => {
        if (port.portPointId) {
          const index = this.named.get(port.portPointId)
          if (index === undefined) throw new Error(`Missing physical endpoint "${port.portPointId}"`)
          const owner = physical.getOwner(port), event = this.events[index]!
          if (owner !== event.owner) throw new Error(`Conflicting electrical owners for endpoint "${port.portPointId}"`)
          return index
        }
        const index = this.events.length
        this.events.push({ port, owner: physical.getOwner(port), width: physical.getWidth(port),
          variable: { id: `fixed:${node.capacityMeshNodeId}:${pointIndex}`, x: port.x, y: port.y, dx: 0, dy: 0, domains: [[0, 0]], preferred: 0 } })
        return index
      })
      for (let first = 0; first < indices.length; first++) for (let second = first + 1; second < indices.length; second++) {
        const a = indices[first]!, b = indices[second]!
        if (a === b) continue
        const firstEvent = this.events[a]!, secondEvent = this.events[b]!
        if (firstEvent.port.z !== secondEvent.port.z ||
          (firstEvent.owner !== undefined && firstEvent.owner === secondEvent.owner) ||
          firstEvent.port.connectionName === secondEvent.port.connectionName) continue
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        if (pairs.has(key)) continue
        pairs.add(key)
        const gap = Math.max(0, (firstEvent.width + secondEvent.width) / 2 + physical.traceClearance - TRACE_ENGINE_TOLERANCE)
        this.distances.push({ first: a, second: b, gap })
      }
    }
    this.selected.push(...this.events.map((event) => event.variable.preferred))
    const parent = this.events.map((_, index) => index)
    const find = (index: number): number => {
      let current = index
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]!]!
        current = parent[current]!
      }
      return current
    }
    const activeDistances = this.distances.filter((constraint) => {
      const first = this.domainBounds(this.events[constraint.first]!.variable)
      const second = this.domainBounds(this.events[constraint.second]!.variable)
      return Math.hypot(Math.max(first.minX - second.maxX, second.minX - first.maxX, 0),
        Math.max(first.minY - second.maxY, second.minY - first.maxY, 0)) < constraint.gap
    })
    for (const constraint of [...this.orders, ...activeDistances, ...this.anchorOrders]) {
      const a = find(constraint.first), b = find(constraint.second)
      if (a !== b) parent[b] = a
    }
    const violated = new Set<number>()
    for (const constraint of this.distances) {
      const a = this.worldPoint(constraint.first, this.selected[constraint.first]!)
      const b = this.worldPoint(constraint.second, this.selected[constraint.second]!)
      if (!this.separated(a, b, constraint.gap)) violated.add(find(constraint.first))
    }
    for (let index = 0; index < this.events.length; index++) {
      if (!this.events[index]!.variable.domains.some(([low, high]) =>
        this.selected[index]! >= low && this.selected[index]! <= high)) violated.add(find(index))
    }
    for (const constraint of this.orders) {
      if (this.selected[constraint.second]! - this.selected[constraint.first]! < constraint.gap)
        violated.add(find(constraint.first))
    }
    for (const constraint of this.anchorOrders) {
      const first = this.worldPoint(constraint.first, this.selected[constraint.first]!)
      const second = this.worldPoint(constraint.second, this.selected[constraint.second]!)
      if (first[constraint.axis] > second[constraint.axis]) violated.add(find(constraint.first))
    }
    const components = new Map<number, number[]>()
    for (let index = 0; index < this.events.length; index++) {
      const root = find(index)
      if (!violated.has(root)) continue
      let component = components.get(root)
      if (!component) components.set(root, component = [])
      component.push(index)
    }
    for (const indices of components.values()) {
      const local = new Map(indices.map((global, index) => [global, index]))
      const remap = (constraints: CoupledPortPlacementConstraint[]): CoupledPortPlacementConstraint[] => {
        const result: CoupledPortPlacementConstraint[] = []
        for (const constraint of constraints) {
          const first = local.get(constraint.first), second = local.get(constraint.second)
          if (first !== undefined && second !== undefined) result.push({ first, second, gap: constraint.gap })
        }
        return result
      }
      this.jobs.push({ indices, input: { variables: indices.map((index) => this.events[index]!.variable),
        orderConstraints: remap(this.orders), distanceConstraints: remap(activeDistances),
        solutionValidator: (values): boolean => {
          if (!indices.every((global, index) => physical.isPortClear({ ...this.events[global]!.port, ...this.worldPoint(global, values[index]!) }))) return false
          for (const order of this.anchorOrders) {
            const firstLocal = local.get(order.first), secondLocal = local.get(order.second)
            if (firstLocal === undefined && secondLocal === undefined) continue
            const first = this.worldPoint(order.first, firstLocal === undefined ? this.selected[order.first]! : values[firstLocal]!)
            const second = this.worldPoint(order.second, secondLocal === undefined ? this.selected[order.second]! : values[secondLocal]!)
            if (first[order.axis] > second[order.axis]) return false
          }
          return true
        } } })
    }
  }

  private worldPoint(index: number, distance: number): Point {
    const variable = this.events[index]!.variable
    return {
      x: variable.x + variable.dx * distance,
      y: variable.y + variable.dy * distance,
    }
  }

  private domainBounds(variable: CoupledPortPlacementVariable): { minX: number; maxX: number; minY: number; maxY: number } {
    if (variable.domains.length === 0) throw new Error(`No physical domain for port "${variable.id}"`)
    const points = variable.domains.flatMap(([low, high]: EdgeInterval) =>
      [low, high].map((distance) => ({ x: variable.x + variable.dx * distance, y: variable.y + variable.dy * distance })))
    return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
      minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) }
  }

  private separated(first: Point, second: Point, gap: number): boolean {
    const dx = first.x - second.x
    const dy = first.y - second.y
    const distance = Math.hypot(dx, dy)
    return distance >= gap
  }

  accept(job: CoupledSharedEdgeJob, values: readonly number[]): void {
    if (values.length !== job.indices.length) throw new Error("Coupled shared-edge output has the wrong length")
    for (let index = 0; index < values.length; index++) {
      const global = job.indices[index]!, value = values[index]!
      if (!Number.isFinite(value)) throw new Error("Nonfinite coupled shared-edge coordinate")
      this.selected[global] = value
    }
  }

  getValidatedPositions(): Map<string, Point> {
    const output = new Map<string, Point>()
    for (let index = 0; index < this.events.length; index++) {
      const event = this.events[index]!, value = this.selected[index]!, point = this.worldPoint(index, value)
      if (!event.variable.domains.some(([low, high]) => value >= low && value <= high))
        throw new Error(`Coupled endpoint "${event.variable.id}" left its physical domain`)
      if (!this.physical.isPortClear({ ...event.port, ...point }))
        throw new Error(`Coupled endpoint "${event.variable.id}" violates physical copper`)
      if (event.port.portPointId) output.set(event.port.portPointId, point)
    }
    for (const constraint of this.orders) {
      const first = this.selected[constraint.first]!, second = this.selected[constraint.second]!
      if (second - first < constraint.gap) throw new Error("Coupled placement reversed a shared-face order")
    }
    for (const constraint of this.anchorOrders) {
      const first = this.worldPoint(constraint.first, this.selected[constraint.first]!)
      const second = this.worldPoint(constraint.second, this.selected[constraint.second]!)
      if (first[constraint.axis] > second[constraint.axis]) throw new Error("Coupled placement crossed an anchored endpoint")
    }
    for (const constraint of this.distances) {
      const first = this.worldPoint(constraint.first, this.selected[constraint.first]!)
      const second = this.worldPoint(constraint.second, this.selected[constraint.second]!)
      if (!this.separated(first, second, constraint.gap)) throw new Error("Coupled placement left foreign endpoints too close")
    }
    return output
  }
}
