import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import {
  preparePipeline9PhysicalObstacle,
  type PreparedPhysicalObstacle,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9PhysicalObstacle"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  getSharedEdgeBoardIntervals,
  getSharedEdgeObstacleIntervals,
  subtractEdgeIntervals,
  type EdgeInterval,
} from "./getSharedEdgePhysicalIntervals"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

type PortGeometry = {
  owner: string | undefined
  width: number
  allowed: EdgeInterval[]
}
export type PhysicalSharedEdgeQuery = {
  z: number
  owner: string | undefined
  width: number
}
const TRACE_ENGINE_TOLERANCE = 0.005
const EPSILON = 1e-9

/** Places existing shared ports using declared owners and physical board geometry. */
export class PhysicalSharedEdgePlacement {
  private readonly context
  private readonly validator
  private readonly viaDiameter: number
  private readonly widths = new Map<string, number>()
  private readonly prepared = new Map<Obstacle, PreparedPhysicalObstacle>()
  private readonly traceClearance: number

  constructor(private readonly physicalSrj: SimpleRouteJson) {
    this.context = getPipeline9PhysicalGeometryContext(physicalSrj)
    this.traceClearance = physicalSrj.minTraceToPadEdgeClearance ?? 0.1
    if (
      ![physicalSrj.minTraceWidth, this.traceClearance].every(
        Number.isFinite,
      ) ||
      physicalSrj.minTraceWidth <= 0 ||
      this.traceClearance < 0
    )
      throw new Error(
        "Uniform port placement requires valid physical trace rules",
      )
    for (const connection of physicalSrj.connections) {
      const width = Math.max(
        physicalSrj.minTraceWidth,
        connection.nominalTraceWidth ??
          connection.width ??
          physicalSrj.minTraceWidth,
      )
      if (!Number.isFinite(width) || width <= 0)
        throw new Error("Invalid connection trace width")
      this.widths.set(connection.name, width)
    }
    this.viaDiameter = getViaDimensions(physicalSrj).padDiameter
    this.validator = createPipeline9StaticSegmentValidator(physicalSrj)
  }

  private getOwner(port: PortPoint): string | undefined {
    const owners = new Set<string>()
    for (const id of [port.connectionName, port.rootConnectionName]) {
      if (id === undefined) continue
      const owner = this.context.connMap.getNetConnectedToId(id)
      if (owner !== undefined) owners.add(owner)
    }
    if (owners.size > 1)
      throw new Error(`Ambiguous physical owner for port "${port.portPointId}"`)
    return owners.values().next().value
  }

  private getWidth(port: PortPoint): number {
    const direct = this.widths.get(port.connectionName)
    const root =
      port.rootConnectionName === undefined
        ? undefined
        : this.widths.get(port.rootConnectionName)
    const width = direct ?? root ?? this.physicalSrj.minTraceWidth
    if (!Number.isFinite(width) || width <= 0)
      throw new Error("Invalid physical port width")
    return width
  }

  private getPrepared(obstacle: Obstacle): PreparedPhysicalObstacle {
    let prepared = this.prepared.get(obstacle)
    if (!prepared) {
      prepared = preparePipeline9PhysicalObstacle(
        obstacle,
        this.context.connMap,
      )
      this.prepared.set(obstacle, prepared)
    }
    return prepared
  }

  /** Pure geometry query shared by placement and permanent edge-capacity checks. */
  getAllowedIntervals(
    edge: SharedEdge,
    { owner, width, z }: PhysicalSharedEdgeQuery,
  ): EdgeInterval[] {
    if (
      !Number.isInteger(z) ||
      z < 0 ||
      z >= this.physicalSrj.layerCount ||
      !Number.isFinite(width) ||
      width <= 0
    )
      throw new Error("Invalid physical shared-edge layer or trace width")
    let allowed = getSharedEdgeBoardIntervals(edge, this.physicalSrj, width / 2)
    const reach =
      width / 2 +
      Math.max(
        this.traceClearance,
        this.physicalSrj.minTraceToHoleEdgeClearance ?? 0,
      )
    const nearby =
      this.context.index?.search(
        Math.min(edge.x1, edge.x2) - reach,
        Math.min(edge.y1, edge.y2) - reach,
        Math.max(edge.x1, edge.x2) + reach,
        Math.max(edge.y1, edge.y2) + reach,
      ) ?? []
    for (const index of nearby) {
      const obstacle = this.context.obstacles[index]!
      const prepared = this.getPrepared(obstacle)
      if (
        !prepared.layers.has(z) ||
        (owner !== undefined && prepared.owners.has(owner))
      )
        continue
      const rawClearance = prepared.opaque
        ? 0
        : prepared.nonPlatedHole
          ? (this.physicalSrj.minTraceToHoleEdgeClearance ??
            this.traceClearance)
          : this.traceClearance
      if (!Number.isFinite(rawClearance) || rawClearance < 0)
        throw new Error("Invalid physical obstacle clearance")
      for (const [shape, clearance, tolerance] of [
        [prepared.engineShape, this.traceClearance, TRACE_ENGINE_TOLERANCE],
        [prepared.rawShape, rawClearance, 1e-8],
      ] as const) {
        if (!shape) continue
        const representation = {
          ...obstacle,
          type: shape.kind,
          shape: undefined,
          width: shape.width,
          height: shape.height,
        } as Obstacle
        allowed = subtractEdgeIntervals(
          allowed,
          getSharedEdgeObstacleIntervals(
            edge,
            representation,
            Math.max(0, width / 2 + clearance - tolerance),
          ),
        )
      }
    }
    return allowed
  }

  private lastAllowed(intervals: EdgeInterval[], maximum: number): number | undefined {
    for (let i = intervals.length - 1; i >= 0; i--) {
      const [low, high] = intervals[i]!
      const value = Math.min(high, maximum)
      if (value >= low - EPSILON) return Math.max(value, low)
    }
    return undefined
  }

  redistribute(edge: SharedEdge, ports: PortPointWithOwnerPair[]): PortPointWithOwnerPair[] {
    const output: PortPointWithOwnerPair[] = []
    const layers = [...new Set(ports.map((port) => port.z))].sort((a, b) => a - b)
    for (const z of layers) {
      const family = ports.filter((port) => port.z === z).sort((a, b) =>
        (edge.orientation === "horizontal" ? a.x - b.x : a.y - b.y) ||
        (a.portPointId ?? "").localeCompare(b.portPointId ?? ""))
      const geometry: PortGeometry[] = family.map((port) => {
        const owner = this.getOwner(port), width = this.getWidth(port)
        return { owner, width, allowed: this.getAllowedIntervals(edge, { owner, width, z }) }
      })
      const gaps = family.map((port, index) => family.map((previous, j) => {
        if (index === j) return 0
        const a = geometry[j]!, b = geometry[index]!
        const sameOwner = a.owner !== undefined && a.owner === b.owner
        return sameOwner || port.connectionName === previous.connectionName ? 0
          : Math.max(0, (a.width + b.width) / 2 + this.traceClearance - TRACE_ENGINE_TOLERANCE)
      }))
      const latest: number[] = []
      for (let i = family.length - 1; i >= 0; i--) {
        const maximum = Math.min(edge.length, ...latest.slice(i + 1).map((position, offset) => position - gaps[i]![i + 1 + offset]!))
        const value = this.lastAllowed(geometry[i]!.allowed, maximum)
        if (value === undefined) throw new Error(`No owner-clear ordered placement on shared edge "${edge.ownerPairKey}" at z=${z} for port "${family[i]!.portPointId}"`)
        latest[i] = value
      }
      const positions: number[] = []
      for (let i = 0; i < family.length; i++) {
        const port = family[i]!, shape = geometry[i]!
        const minimum = Math.max(0, ...positions.map((position, j) => position + gaps[i]![j]!))
        const fraction = (2 * i + 1) / (2 * family.length)
        let distance = shape.allowed.reduce((sum, [low, high]) => sum + high - low, 0) * fraction
        let ideal: number | undefined
        for (const [low, high] of shape.allowed) {
          if (distance <= high - low) { ideal = low + distance; break }
          distance -= high - low
        }
        if (ideal === undefined) throw new Error(`No physical interval for port "${port.portPointId}"`)
        const preferred = ideal
        const candidates = shape.allowed.flatMap(([low, high]) => {
          const start = Math.max(low, minimum), end = Math.min(high, latest[i]!)
          if (start > end) return []
          // Keep proof domains inclusive; only selected positions move away
          // from round-off at an obstacle boundary when interior space exists.
          const inset = Math.min(EPSILON, (end - start) / 4)
          return [Math.min(end - inset, Math.max(start + inset, preferred))]
        })
        candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)
        const position = candidates[0]
        if (position === undefined)
          throw new Error(`No owner-clear ordered placement on shared edge "${edge.ownerPairKey}" at z=${z} for port "${port.portPointId}"`)
        const x = edge.x1 + (edge.x2 - edge.x1) * position / edge.length
        const y = edge.y1 + (edge.y2 - edge.y1) * position / edge.length
        const point = { x, y, z }
        if (!this.validator({
          connectionName: port.connectionName, rootConnectionName: port.rootConnectionName,
          traceThickness: shape.width, viaDiameter: this.viaDiameter,
          start: point, end: { ...point },
        })) throw new Error(`Analytical physical port placement failed validation for "${port.portPointId}" on "${edge.ownerPairKey}"`)
        output.push({ ...port, x, y })
        positions.push(position)
      }
    }
    return output
  }
}
