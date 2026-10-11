/**
 * Prototype derivative of @tscircuit/repair04 at
 * 81d4585d335ea1958a1c6569e4064c58cba44bad (MIT, see ./LICENSE).
 * Preserve projection order, exact geometry and all logical work accounting.
 */
import { BaseSolver } from "@tscircuit/solver-utils"
import Flatbush from "flatbush"
import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"
import { getRepairCopperLayerSpan } from "./repair04Helpers"
import { getVectorLength } from "./repair04Helpers"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "high-density-repair03/lib"
import {
  getLocalObstacleGeometry,
  getLocalObstacleDistance,
  type ObstacleDistanceGeometry,
} from "./obstacleDistanceGeometry"
import { getNetRepresentatives } from "./repair04Helpers"
import { getViaPadClearance } from "./repair04Helpers"
import { getRepairJunctionAnchors } from "./getRepairJunctionAnchors"
import { REGION_EPSILON } from "./repair04Helpers"
import { areExpandedBoundsSeparated } from "./repair04Helpers"
import type {
  Bounds,
  RepairRegionInput,
  RepairRoutePoint,
} from "./repair04Helpers"

type Point = { x: number; y: number }
type Vertex = Point & {
  original: Point
  locked: boolean
  radius: number
  revision: number
  bounds: Bounds
  points: RepairRoutePoint[]
}
type Segment = {
  a: Vertex
  b: Vertex
  initialBounds: Bounds
  boundsCache?: SegmentBoundsCache
  minZ: number
  maxZ: number
  radius: number
  net: string
  routeIndex: number
  via: boolean
}
type SegmentBoundsCache = Bounds & {
  aX: number
  aY: number
  bX: number
  bY: number
}
type Contact = { s: number; t: number; x: number; y: number; distance: number }
type ViaPadConstraint = {
  center: Point
  cosine: number
  sine: number
  shape: ObstacleDistanceGeometry
  clearance: number
  distanceCache?: ViaPadDistanceCache
}
type ViaPadDistanceCache = {
  localX: number
  localY: number
  distance: number
} & (
  | { type: "rect"; minX: number; maxX: number; minY: number; maxY: number }
  | { type: "oval"; aX: number; aY: number; bX: number; bY: number; radius: number }
)
type SegmentPair = {
  a: Segment
  b: Segment
  revisions: [number, number, number, number]
  contact: Contact | null
  weights: [Vertex, number][]
  required: number
  separated: boolean
  separationDistanceSquared: number
}
type PadContact = {
  segment: Segment
  corners: Point[]
  required: number
  revisions: [number, number]
  contact: Contact | null
  interiorRevisions: [number, number]
  interiors: [InteriorPadContact | null, InteriorPadContact | null]
  weights: [Vertex, number][]
  endpointWeights: [[Vertex, number][], [Vertex, number][]]
}
type InteriorPadContact = { x: number; y: number; depth: number }

const MAX_SWEEPS = 256
const MAX_DISPLACEMENT = 0.25

/** Closest points and their interpolation weights, including zero-length vias. */
function getContact(a: Point, b: Point, c: Point, d: Point): Contact {
  const ux = b.x - a.x,
    uy = b.y - a.y
  const vx = d.x - c.x,
    vy = d.y - c.y
  const wx = a.x - c.x,
    wy = a.y - c.y
  const aa = ux * ux + uy * uy,
    bb = ux * vx + uy * vy
  const cc = vx * vx + vy * vy,
    dd = ux * wx + uy * wy
  const ee = vx * wx + vy * wy,
    determinant = aa * cc - bb * bb
  let s =
    determinant > 1e-15
      ? Math.max(0, Math.min(1, (bb * ee - cc * dd) / determinant))
      : 0
  if (cc < 1e-15) s = aa > 1e-15 ? Math.max(0, Math.min(1, -dd / aa)) : 0
  let t = cc > 1e-15 ? (bb * s + ee) / cc : 0
  if (t < 0) {
    t = 0
    s = aa > 1e-15 ? Math.max(0, Math.min(1, -dd / aa)) : 0
  } else if (t > 1) {
    t = 1
    s = aa > 1e-15 ? Math.max(0, Math.min(1, (bb - dd) / aa)) : 0
  }
  const x = a.x + s * ux - c.x - t * vx
  const y = a.y + s * uy - c.y - t * vy
  return { s, t, x, y, distance: getVectorLength(x, y) }
}

/** Signed distance to the nearest face of a containing convex pad. */
function getInteriorPadContact(
  point: Point,
  corners: Point[],
): InteriorPadContact | null {
  let contact = { x: 0, y: 0, depth: Infinity }
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!,
      b = corners[(i + 1) % corners.length]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    const length = getVectorLength(dx, dy)
    const x = dy / length,
      y = -dx / length
    const depth = -((point.x - a.x) * x + (point.y - a.y) * y)
    if (depth < 0) return null
    if (depth < contact.depth) contact = { x, y, depth }
  }
  return contact
}

/** Projects clearance constraints with persistent setup and sweep cursors. */
export class Pipeline9IndexedRelaxTraceClearanceSolver extends BaseSolver {
  readonly input: RelaxTraceClearanceInput
  private phase: "geometry" | "pairs" | "obstacles" | "sweeps" | "finalize" =
    "geometry"
  private routes: HighDensityRoute[] = []
  private nets = new Map<string, string>()
  private vertices = new Map<string, Vertex>()
  private segments: Segment[] = []
  private pairs: SegmentPair[] = []
  private padContacts: PadContact[] = []
  private viaPadConstraints = new Map<Vertex, ViaPadConstraint[]>()
  private traceClearance = 0.1
  private viaClearance = 0.1
  private pairOuterIndex = 0
  private pairInnerIndex = 1
  private obstacleIndex = 0
  private sweepIndex = 0
  private sweepPairIndex = 0
  private sweepPadIndex = 0
  private preparedPairCount = 0
  private projectedConstraintCount = 0
  private segmentIndex?: Flatbush
  private canRejectSeparatedPairs = false
  private pairCandidateOuterIndex = -1
  private pairCandidates: number[] = []
  private pairCandidateCursor = 0
  private readonly combinedVertices: Vertex[] = []
  private readonly combinedWeights: number[] = []

  constructor(input: RelaxTraceClearanceInput) {
    super()
    this.input = input
    this.MAX_ITERATIONS = 1024
  }

  private prepareGeometry(): void {
    const input = this.input
    const routes = structuredClone(input.routes)
    const nets = getNetRepresentatives(input.srj, routes)
    const traceClearance = input.traceClearance ?? 0.1
    const viaClearance = input.viaClearance ?? 0.1
    const mutable: Bounds = {
      minX: input.bounds.minX + input.boundaryMargin,
      maxX: input.bounds.maxX - input.boundaryMargin,
      minY: input.bounds.minY + input.boundaryMargin,
      maxY: input.bounds.maxY - input.boundaryMargin,
    }
    // Keep existing endpoint, wire and via attachments without inserting points.
    // Retaining both ends of the contacted segment also retains interior contacts.
    const junctions = getRepairJunctionAnchors(input.srj, routes, input.bounds)
    const vertices = new Map<string, Vertex>()
    const routeVertices = routes.map((route, ri): Vertex[] =>
      route.route.map((point, pi): Vertex => {
        const key = `${nets.get(route.connectionName)}:${point.x}:${point.y}`
        let vertex = vertices.get(key)
        if (!vertex) {
          vertex = {
            x: point.x,
            y: point.y,
            original: { x: point.x, y: point.y },
            locked: false,
            radius: 0,
            revision: 0,
            bounds: mutable,
            points: [],
          }
          vertices.set(key, vertex)
        }
        vertex.points.push(point)
        vertex.locked ||= Boolean(
          input.lockedPointIndices[ri]![pi] ||
            junctions[ri]!.segmentTimes.has(pi) ||
            junctions[ri]!.segmentTimes.has(pi - 1) ||
            junctions[ri]!.viaPositions.some(
              (via): boolean =>
                Math.hypot(via.x - point.x, via.y - point.y) <= REGION_EPSILON,
            ) ||
            pi === 0 ||
            pi === route.route.length - 1 ||
            point.pcb_port_id ||
            point.insideJumperPad ||
            point.toNextSegmentType ||
            point.x <= mutable.minX ||
            point.x >= mutable.maxX ||
            point.y <= mutable.minY ||
            point.y >= mutable.maxY,
        )
        return vertex
      }),
    )
    const segments: Segment[] = []
    for (let ri = 0; ri < routes.length; ri++) {
      const route = routes[ri]!
      for (let pi = 1; pi < route.route.length; pi++) {
        const a = route.route[pi - 1]! as RepairRoutePoint,
          b = route.route[pi]! as RepairRoutePoint
        if (a.toNextSegmentType || a.insideJumperPad || b.insideJumperPad)
          continue
        const va = routeVertices[ri]![pi - 1]!,
          vb = routeVertices[ri]![pi]!
        const via = a.z !== b.z
        if (via && input.allowViaMovement !== true) va.locked = vb.locked = true
        segments.push({
          a: va,
          b: vb,
          initialBounds: {
            minX: Math.min(va.x, vb.x),
            maxX: Math.max(va.x, vb.x),
            minY: Math.min(va.y, vb.y),
            maxY: Math.max(va.y, vb.y),
          },
          ...getRepairCopperLayerSpan(input.srj, a, b),
          radius: via
            ? route.viaDiameter / 2
            : Math.max(
                a.traceThickness ?? route.traceThickness,
                b.traceThickness ?? route.traceThickness,
              ) / 2,
          net: nets.get(route.connectionName)!,
          routeIndex: ri,
          via,
        })
      }
    }
    for (const segment of segments) {
      segment.a.radius = Math.max(segment.a.radius, segment.radius)
      segment.b.radius = Math.max(segment.b.radius, segment.radius)
    }
    if (input.boardEdgeClearance !== undefined) {
      const board = input.srj.bounds
      for (const vertex of vertices.values()) {
        const margin = vertex.radius + input.boardEdgeClearance
        vertex.bounds = {
          minX: Math.max(
            mutable.minX,
            Math.min(vertex.original.x, board.minX + margin),
          ),
          maxX: Math.min(
            mutable.maxX,
            Math.max(vertex.original.x, board.maxX - margin),
          ),
          minY: Math.max(
            mutable.minY,
            Math.min(vertex.original.y, board.minY + margin),
          ),
          maxY: Math.min(
            mutable.maxY,
            Math.max(vertex.original.y, board.maxY - margin),
          ),
        }
      }
    }

    this.routes = routes
    this.nets = nets
    this.vertices = vertices
    this.segments = segments
    this.traceClearance = traceClearance
    this.viaClearance = viaClearance
    const pairCount = (segments.length * (segments.length - 1)) / 2
    // In this ordinary finite PCB domain, the outward epsilon dominates the
    // arithmetic rounding incurred by separate radius expansion. Outside it,
    // retain the original pair traversal and predicates.
    if (
      segments.length > 0 && Number.isSafeInteger(pairCount) &&
      [traceClearance, viaClearance].every(
        (value): boolean => Number.isFinite(value) && value >= 0 && value <= 10_000,
      ) &&
      segments.every((segment): boolean =>
        segment.radius >= 0 &&
        [segment.radius, ...Object.values(segment.initialBounds)].every(
          (value): boolean => Number.isFinite(value) && Math.abs(value) <= 10_000,
        ),
      )
    ) {
      const index = new Flatbush(segments.length)
      for (const segment of segments) {
        index.add(
          segment.initialBounds.minX - segment.radius - REGION_EPSILON * 4,
          segment.initialBounds.minY - segment.radius - REGION_EPSILON * 4,
          segment.initialBounds.maxX + segment.radius + REGION_EPSILON * 4,
          segment.initialBounds.maxY + segment.radius + REGION_EPSILON * 4,
        )
      }
      index.finish()
      this.segmentIndex = index
    }
    // Projection clips against these bounds and each original point +/- 0.25.
    // In this finite domain, the outward epsilon below dominates the rounding
    // in both the AABB distance and the original interpolated contact points.
    // Keep the original contact calculation for other coordinate domains.
    this.canRejectSeparatedPairs = this.segmentIndex !== undefined &&
      [...vertices.values()].every((vertex): boolean =>
        Object.values(vertex.bounds).every((value): boolean =>
          Number.isFinite(value) && Math.abs(value) <= 10_000 + MAX_DISPLACEMENT,
        ),
      )
    const padCount = segments.length * input.srj.obstacles.length
    this.MAX_ITERATIONS =
      this.iterations +
      Math.ceil(pairCount / 4096) +
      Math.ceil(input.srj.obstacles.length / 16) +
      MAX_SWEEPS * Math.max(1, Math.ceil((pairCount + padCount) / 4096)) +
      4
    this.phase = "pairs"
  }

  private preparePairs(): void {
    let processed = 0
    while (processed < 4096 && this.pairOuterIndex < this.segments.length) {
      if (this.pairInnerIndex >= this.segments.length) {
        this.pairOuterIndex++
        this.pairInnerIndex = this.pairOuterIndex + 1
        continue
      }
      if (this.segmentIndex) {
        if (this.pairCandidateOuterIndex !== this.pairOuterIndex) {
          const outer = this.segments[this.pairOuterIndex]!
          const reach = outer.radius +
            Math.max(this.traceClearance, this.viaClearance) +
            2 * Math.SQRT2 * MAX_DISPLACEMENT
          this.pairCandidates = this.segmentIndex.search(
            outer.initialBounds.minX - reach - REGION_EPSILON * 4,
            outer.initialBounds.minY - reach - REGION_EPSILON * 4,
            outer.initialBounds.maxX + reach + REGION_EPSILON * 4,
            outer.initialBounds.maxY + reach + REGION_EPSILON * 4,
          ).filter((index): boolean => index > this.pairOuterIndex)
            .sort((left, right): number => left - right)
          this.pairCandidateOuterIndex = this.pairOuterIndex
          this.pairCandidateCursor = 0
        }
        while (
          this.pairCandidateCursor < this.pairCandidates.length &&
          this.pairCandidates[this.pairCandidateCursor]! < this.pairInnerIndex
        ) this.pairCandidateCursor++
        const next = this.pairCandidates[this.pairCandidateCursor] ?? this.segments.length
        const skipped = Math.min(next - this.pairInnerIndex, 4096 - processed)
        // Distance-separated pairs still count as exactly the same logical
        // work. Advance their original cursor and batch counters arithmetically
        // so every public step boundary, budget and statistic remains unchanged.
        this.pairInnerIndex += skipped
        this.preparedPairCount += skipped
        processed += skipped
        if (processed === 4096 || this.pairInnerIndex === this.segments.length)
          continue
      }
      const a = this.segments[this.pairOuterIndex]!
      const b = this.segments[this.pairInnerIndex++]!
      processed++
      this.preparedPairCount++
      if (a.net === b.net || a.maxZ < b.minZ || b.maxZ < a.minZ) continue
      const reach =
        a.radius +
        b.radius +
        Math.max(this.traceClearance, this.viaClearance) +
        2 * Math.SQRT2 * MAX_DISPLACEMENT
      if (areExpandedBoundsSeparated(a.initialBounds, b.initialBounds, reach))
        continue
      if (segmentToSegmentMinDistance(a.a, a.b, b.a, b.b) <= reach) {
        const required = a.radius + b.radius +
          (a.via && b.via ? this.viaClearance : this.traceClearance)
        const separationDistance = required + REGION_EPSILON * 4
        this.pairs.push({
          a, b, revisions: [-1, -1, -1, -1], contact: null,
          weights: [[a.a, 0], [a.b, 0], [b.a, 0], [b.b, 0]],
          required,
          separated: false,
          separationDistanceSquared: separationDistance * separationDistance,
        })
      }
    }
    if (this.pairOuterIndex >= this.segments.length) this.phase = "obstacles"
    this.stats = {
      ...this.stats,
      preparedPairCount: this.preparedPairCount,
      pairCount: this.pairs.length,
      lastPreparedPairBatchCount: processed,
    }
  }

  private prepareObstacles(): void {
    const {
      input,
      nets,
      segments,
      traceClearance,
      viaClearance,
      padContacts,
      viaPadConstraints,
    } = this
    let processed = 0
    while (processed < 16 && this.obstacleIndex < input.srj.obstacles.length) {
      const obstacle = input.srj.obstacles[this.obstacleIndex++]!
      processed++
      const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cosine = Math.cos(radians),
        sine = Math.sin(radians)
      const obstacleNets = new Set(
        obstacle.connectedTo.map((name) => nets.get(name) ?? name),
      )
      const zs =
        (obstacle as typeof obstacle & { __zLayers?: number[] }).__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((name): number =>
          name === "top"
            ? 0
            : name === "bottom"
              ? input.srj.layerCount - 1
              : Number(name.slice(5)),
        )
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(
        ([x, y]): Point => ({
          x:
            obstacle.center.x +
            (cosine * x! * obstacle.width) / 2 -
            (sine * y! * obstacle.height) / 2,
          y:
            obstacle.center.y +
            (sine * x! * obstacle.width) / 2 +
            (cosine * y! * obstacle.height) / 2,
        }),
      )
      const padBounds = {
        minX: Math.min(...corners.map((corner): number => corner.x)),
        maxX: Math.max(...corners.map((corner): number => corner.x)),
        minY: Math.min(...corners.map((corner): number => corner.y)),
        maxY: Math.max(...corners.map((corner): number => corner.y)),
      }
      const obstacleReach = Math.max(
        traceClearance, viaClearance,
        input.srj.defaultObstacleMargin ?? 0,
        input.srj.minTraceToPadEdgeClearance ?? 0,
        input.srj.minTraceToHoleEdgeClearance ?? 0,
        input.srj.minViaEdgeToPadEdgeClearance ?? 0,
      ) + Math.SQRT2 * MAX_DISPLACEMENT
      const indexedSegments = this.segmentIndex &&
        [...Object.values(padBounds), obstacleReach].every(
          (value): boolean => Number.isFinite(value) && Math.abs(value) <= 10_000,
        )
        ? this.segmentIndex.search(
            padBounds.minX - obstacleReach - REGION_EPSILON * 4,
            padBounds.minY - obstacleReach - REGION_EPSILON * 4,
            padBounds.maxX + obstacleReach + REGION_EPSILON * 4,
            padBounds.maxY + obstacleReach + REGION_EPSILON * 4,
          ).sort((left, right): number => left - right)
        : undefined
      const candidates = indexedSegments
        ? indexedSegments.map((index): Segment => segments[index]!)
        : segments
      for (const segment of candidates) {
        if (
          (!segment.via && obstacleNets.has(segment.net)) ||
          !zs.some((z) => z >= segment.minZ && z <= segment.maxZ)
        )
          continue
        const reach =
          segment.radius +
          Math.max(
            traceClearance,
            viaClearance,
            input.srj.defaultObstacleMargin ?? 0,
            input.srj.minTraceToPadEdgeClearance ?? 0,
            input.srj.minTraceToHoleEdgeClearance ?? 0,
            input.srj.minViaEdgeToPadEdgeClearance ?? 0,
          ) +
          Math.SQRT2 * MAX_DISPLACEMENT
        // Enclose all four transformed corners, including rotated pads. Keep
        // the original edge-distance predicate whenever the expanded bounds meet.
        if (areExpandedBoundsSeparated(segment.initialBounds, padBounds, reach))
          continue
        if (
          Math.min(
            ...corners.map((a, i) =>
              segmentToSegmentMinDistance(
                segment.a,
                segment.b,
                a,
                corners[(i + 1) % 4]!,
              ),
            ),
          ) > reach
        )
          continue
        // Use the enclosing rectangle as a conservative routing constraint for
        // every pad shape. Physical via guards retain the exact obstacle shape.
        const required =
          segment.radius +
          (segment.via
            ? getViaPadClearance(
                input.srj,
                viaClearance,
                obstacleNets.has(segment.net),
              )
            : obstacle.isNonPlatedHole &&
                input.srj.minTraceToHoleEdgeClearance !== undefined
              ? input.srj.minTraceToHoleEdgeClearance
              : Math.max(
                  traceClearance,
                  input.srj.defaultObstacleMargin ?? 0,
                  input.srj.minTraceToPadEdgeClearance ?? 0,
                ))
        padContacts.push({
          segment,
          corners,
          required,
          revisions: [-1, -1],
          contact: null,
          interiorRevisions: [-1, -1],
          interiors: [null, null],
          weights: [[segment.a, 0], [segment.b, 0]],
          endpointWeights: [[[segment.a, 1]], [[segment.b, 1]]],
        })
        if (segment.via) {
          const constraint: ViaPadConstraint = {
            center: obstacle.center,
            cosine,
            sine,
            shape: getLocalObstacleGeometry(obstacle),
            clearance: required,
          }
          // Topology is unchanged by projection. Existing pad contact may move
          // toward clearance, but no step may worsen its original separation.
          const dx = segment.a.original.x - obstacle.center.x
          const dy = segment.a.original.y - obstacle.center.y
          const local = {
            x: dx * cosine + dy * sine,
            y: -dx * sine + dy * cosine,
          }
          constraint.clearance = Math.min(
            constraint.clearance,
            getLocalObstacleDistance(local, local, constraint.shape),
          )
          for (const vertex of new Set([segment.a, segment.b])) {
            const constraints = viaPadConstraints.get(vertex)
            if (constraints) constraints.push(constraint)
            else viaPadConstraints.set(vertex, [constraint])
          }
        }
      }
    }

    this.stats = {
      ...this.stats,
      preparedObstacleCount: this.obstacleIndex,
      padContactCount: this.padContacts.length,
      lastPreparedObstacleBatchCount: processed,
    }
    if (this.obstacleIndex === input.srj.obstacles.length) {
      this.MAX_ITERATIONS =
        this.iterations +
        MAX_SWEEPS *
          Math.max(
            1,
            Math.ceil((this.pairs.length + this.padContacts.length) / 4096),
          ) +
        2
      this.phase = "sweeps"
    }
  }

  private project(
    weights: [Vertex, number][],
    nx: number,
    ny: number,
    deficit: number,
    allowViaTangents: boolean,
  ): void {
    const viaPadConstraints = this.viaPadConstraints
    const combinedVertices = this.combinedVertices
    const combinedWeights = this.combinedWeights
    combinedVertices.length = 0
    combinedWeights.length = 0
    for (const [vertex, weight] of weights) {
      if (vertex.locked) continue
      const index = combinedVertices.indexOf(vertex)
      if (index === -1) {
        combinedVertices.push(vertex)
        combinedWeights.push(0 + weight)
      } else {
        combinedWeights[index] = combinedWeights[index]! + weight
      }
    }
    // A constraint has at most four vertices. Reuse that small synchronous
    // scratch rather than allocate a Map and spread its entries each sweep;
    // repeated vertices and summation retain their original insertion order.
    let mass = 0
    for (const weight of combinedWeights) mass = mass + weight * weight
    if (mass < 1e-15) return
    const scale = Math.min(0.05, deficit * 0.7) / mass
    for (let index = 0; index < combinedVertices.length; index++) {
      const vertex = combinedVertices[index]!
      const weight = combinedWeights[index]!
      let x = Math.max(
        vertex.bounds.minX,
        vertex.original.x - MAX_DISPLACEMENT,
        Math.min(
          vertex.bounds.maxX,
          vertex.original.x + MAX_DISPLACEMENT,
          vertex.x + nx * scale * weight,
        ),
      )
      let y = Math.max(
        vertex.bounds.minY,
        vertex.original.y - MAX_DISPLACEMENT,
        Math.min(
          vertex.bounds.maxY,
          vertex.original.y + MAX_DISPLACEMENT,
          vertex.y + ny * scale * weight,
        ),
      )
      // Two via sites can slide around pads to satisfy drill spacing. Pad and
      // wire constraints keep their original motion: their movable endpoints
      // may include a shared via without representing a drill-spacing error.
      const pads = viaPadConstraints.get(vertex)
      if (
        pads?.some(
          (pad): boolean =>
            this.getViaPadDistance({ x, y }, pad) < pad.clearance,
        )
      ) {
        if (!allowViaTangents) continue
        const constrained = this.constrainViaDisplacement(
          vertex,
          { x, y },
          pads,
        )
        x = constrained.x
        y = constrained.y
      }
      // Keep the exact physical guard after constraining the displacement.
      if (
        pads?.some(
          (pad): boolean =>
            this.getViaPadDistance({ x, y }, pad) < pad.clearance,
        )
      )
        continue
      if (vertex.x !== x || vertex.y !== y) vertex.revision++
      vertex.x = x
      vertex.y = y
    }
  }

  private getViaPadDistance(point: Point, pad: ViaPadConstraint): number {
    const dx = point.x - pad.center.x,
      dy = point.y - pad.center.y
    const localX = dx * pad.cosine + dy * pad.sine
    const localY = -dx * pad.sine + dy * pad.cosine
    const shape = pad.shape
    const cache = pad.distanceCache
    // Both physical guards often ask about the same proposed position. Compare
    // the complete local geometry, including signed zero, before reusing math.
    if (shape.type === "rect") {
      const bounds = shape.bounds
      if (
        cache?.type === "rect" &&
        Object.is(cache.localX, localX) && Object.is(cache.localY, localY) &&
        Object.is(cache.minX, bounds.minX) && Object.is(cache.maxX, bounds.maxX) &&
        Object.is(cache.minY, bounds.minY) && Object.is(cache.maxY, bounds.maxY)
      ) return cache.distance
      const local = { x: localX, y: localY }
      const distance = getLocalObstacleDistance(local, local, shape)
      if (cache?.type === "rect") {
        cache.localX = localX
        cache.localY = localY
        cache.distance = distance
        cache.minX = bounds.minX
        cache.maxX = bounds.maxX
        cache.minY = bounds.minY
        cache.maxY = bounds.maxY
      } else {
        pad.distanceCache = {
          type: "rect", localX, localY, distance,
          minX: bounds.minX, maxX: bounds.maxX,
          minY: bounds.minY, maxY: bounds.maxY,
        }
      }
      return distance
    }
    if (
      cache?.type === "oval" &&
      Object.is(cache.localX, localX) && Object.is(cache.localY, localY) &&
      Object.is(cache.aX, shape.a.x) && Object.is(cache.aY, shape.a.y) &&
      Object.is(cache.bX, shape.b.x) && Object.is(cache.bY, shape.b.y) &&
      Object.is(cache.radius, shape.radius)
    ) return cache.distance
    const local = { x: localX, y: localY }
    const distance = getLocalObstacleDistance(local, local, shape)
    if (cache?.type === "oval") {
      cache.localX = localX
      cache.localY = localY
      cache.distance = distance
      cache.aX = shape.a.x
      cache.aY = shape.a.y
      cache.bX = shape.b.x
      cache.bY = shape.b.y
      cache.radius = shape.radius
    } else {
      pad.distanceCache = {
        type: "oval", localX, localY, distance,
        aX: shape.a.x, aY: shape.a.y,
        bX: shape.b.x, bY: shape.b.y, radius: shape.radius,
      }
    }
    return distance
  }

  private constrainViaDisplacement(
    vertex: Vertex,
    proposed: Point,
    pads: ViaPadConstraint[],
  ): Point {
    const desired = { x: proposed.x - vertex.x, y: proposed.y - vertex.y }
    const normals: Point[] = []
    for (const pad of pads) {
      if (this.getViaPadDistance(proposed, pad) >= pad.clearance) continue
      const dx = vertex.x - pad.center.x,
        dy = vertex.y - pad.center.y
      const local = {
        x: dx * pad.cosine + dy * pad.sine,
        y: -dx * pad.sine + dy * pad.cosine,
      }
      let nearest: Point
      if (pad.shape.type === "rect") {
        const bounds = pad.shape.bounds
        nearest = {
          x: Math.max(bounds.minX, Math.min(bounds.maxX, local.x)),
          y: Math.max(bounds.minY, Math.min(bounds.maxY, local.y)),
        }
      } else {
        const { a, b } = pad.shape
        const vx = b.x - a.x,
          vy = b.y - a.y
        const lengthSquared = vx * vx + vy * vy
        const t =
          lengthSquared > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((local.x - a.x) * vx + (local.y - a.y) * vy) / lengthSquared,
                ),
              )
            : 0
        nearest = { x: a.x + t * vx, y: a.y + t * vy }
      }
      const ux = local.x - nearest.x,
        uy = local.y - nearest.y
      const normal = {
        x: ux * pad.cosine - uy * pad.sine,
        y: ux * pad.sine + uy * pad.cosine,
      }
      if (normal.x * normal.x + normal.y * normal.y > 1e-20)
        normals.push(normal)
    }

    // In two dimensions the closest feasible displacement is either the
    // origin or its projection onto one of the bounding tangent lines.
    let displacement: Point = { x: 0, y: 0 }
    let error = desired.x * desired.x + desired.y * desired.y
    for (const normal of normals) {
      const dot = desired.x * normal.x + desired.y * normal.y
      const lengthSquared = normal.x * normal.x + normal.y * normal.y
      const tangent = this.shortenDisplacement(vertex, {
        x: desired.x - (normal.x * dot) / lengthSquared,
        y: desired.y - (normal.y * dot) / lengthSquared,
      })
      // This tolerance only handles tangent dot-product rounding. The exact
      // obstacle-distance guard still decides whether the position can move.
      if (
        normals.some(
          (other): boolean =>
            tangent.x * other.x + tangent.y * other.y < -1e-15,
        )
      )
        continue
      const candidateError =
        (tangent.x - desired.x) ** 2 + (tangent.y - desired.y) ** 2
      if (candidateError < error) {
        displacement = tangent
        error = candidateError
      }
    }
    return this.compensateTangentRounding(vertex, displacement, pads, normals)
  }

  private shortenDisplacement(vertex: Vertex, displacement: Point): Point {
    const minX = Math.max(
      vertex.bounds.minX,
      vertex.original.x - MAX_DISPLACEMENT,
    )
    const maxX = Math.min(
      vertex.bounds.maxX,
      vertex.original.x + MAX_DISPLACEMENT,
    )
    const minY = Math.max(
      vertex.bounds.minY,
      vertex.original.y - MAX_DISPLACEMENT,
    )
    const maxY = Math.min(
      vertex.bounds.maxY,
      vertex.original.y + MAX_DISPLACEMENT,
    )
    let scale = 1
    if (displacement.x > 0)
      scale = Math.min(scale, (maxX - vertex.x) / displacement.x)
    if (displacement.x < 0)
      scale = Math.min(scale, (minX - vertex.x) / displacement.x)
    if (displacement.y > 0)
      scale = Math.min(scale, (maxY - vertex.y) / displacement.y)
    if (displacement.y < 0)
      scale = Math.min(scale, (minY - vertex.y) / displacement.y)
    // Shorten the entire ray. Clipping its coordinates independently changes
    // its direction and can send a pad-tangent displacement back into the pad.
    return {
      x:
        Math.max(minX, Math.min(maxX, vertex.x + displacement.x * scale)) -
        vertex.x,
      y:
        Math.max(minY, Math.min(maxY, vertex.y + displacement.y * scale)) -
        vertex.y,
    }
  }

  private compensateTangentRounding(
    vertex: Vertex,
    displacement: Point,
    pads: ViaPadConstraint[],
    normals: Point[],
  ): Point {
    const position = {
      x: vertex.x + displacement.x,
      y: vertex.y + displacement.y,
    }
    const coordinateScale = pads.reduce(
      (scale, pad): number =>
        Math.max(
          scale,
          Math.abs(pad.center.x),
          Math.abs(pad.center.y),
          pad.clearance,
        ),
      Math.max(
        1,
        Math.abs(vertex.x),
        Math.abs(vertex.y),
        Math.abs(position.x),
        Math.abs(position.y),
      ),
    )
    const roundingMargin = 32 * Number.EPSILON * coordinateScale
    const distances = pads.map((pad): number =>
      this.getViaPadDistance(position, pad),
    )
    if (
      distances.every(
        (distance, index): boolean => distance >= pads[index]!.clearance,
      ) ||
      distances.some(
        (distance, index): boolean =>
          distance < pads[index]!.clearance - roundingMargin,
      )
    )
      return position

    // A rotated tangent may round a few ulps inside a pad. Move the candidate
    // outward within the feasible normal cone; never relax the distance guard.
    const unitNormals = normals.map((normal): Point => {
      const length = Math.hypot(normal.x, normal.y)
      return { x: normal.x / length, y: normal.y / length }
    })
    const outward = { x: 0, y: 0 }
    for (const normal of unitNormals) {
      for (const direction of [
        normal,
        { x: -normal.y, y: normal.x },
        { x: normal.y, y: -normal.x },
      ]) {
        if (
          unitNormals.some(
            (other): boolean =>
              direction.x * other.x + direction.y * other.y < -1e-15,
          )
        )
          continue
        outward.x += direction.x
        outward.y += direction.y
      }
    }
    const length = Math.hypot(outward.x, outward.y)
    if (length < 1e-15) return position
    const corrected = this.shortenDisplacement(vertex, {
      x: displacement.x + (outward.x * roundingMargin) / length,
      y: displacement.y + (outward.y * roundingMargin) / length,
    })
    const candidate = { x: vertex.x + corrected.x, y: vertex.y + corrected.y }
    return pads.every(
      (pad): boolean => this.getViaPadDistance(candidate, pad) >= pad.clearance,
    )
      ? candidate
      : position
  }

  private getSegmentBounds(segment: Segment): Bounds {
    const aX = segment.a.x, aY = segment.a.y
    const bX = segment.b.x, bY = segment.b.y
    let cache = segment.boundsCache
    if (
      cache && Object.is(cache.aX, aX) && Object.is(cache.aY, aY) &&
      Object.is(cache.bX, bX) && Object.is(cache.bY, bY)
    ) return cache
    // One endpoint can invalidate many pairs without moving the other segment.
    // Keep its exact bounds separately from the immutable preparation index.
    if (!cache) {
      cache = {
        aX, aY, bX, bY,
        minX: 0, maxX: 0, minY: 0, maxY: 0,
      }
      segment.boundsCache = cache
    }
    cache.aX = aX
    cache.aY = aY
    cache.bX = bX
    cache.bY = bY
    cache.minX = Math.min(aX, bX)
    cache.maxX = Math.max(aX, bX)
    cache.minY = Math.min(aY, bY)
    cache.maxY = Math.max(aY, bY)
    return cache
  }

  private projectPair(pair: SegmentPair): void {
    const { a, b, revisions } = pair
    if (
      a.a.revision !== revisions[0] ||
      a.b.revision !== revisions[1] ||
      b.a.revision !== revisions[2] ||
      b.b.revision !== revisions[3]
    ) {
      pair.separated = false
      if (this.canRejectSeparatedPairs) {
        const aBounds = this.getSegmentBounds(a)
        const bBounds = this.getSegmentBounds(b)
        const gapX = Math.max(
          0,
          aBounds.minX - bBounds.maxX,
          bBounds.minX - aBounds.maxX,
        )
        const gapY = Math.max(
          0,
          aBounds.minY - bBounds.maxY,
          bBounds.minY - aBounds.maxY,
        )
        // Every point on either segment lies within its current AABB. A lower
        // bound separated by the rounding margin needs no clearance displacement.
        // Cache that proof for these revisions without replacing a past contact.
        pair.separated = gapX * gapX + gapY * gapY >
          pair.separationDistanceSquared
      }
      if (!pair.separated) pair.contact = getContact(a.a, a.b, b.a, b.b)
      revisions[0] = a.a.revision
      revisions[1] = a.b.revision
      revisions[2] = b.a.revision
      revisions[3] = b.b.revision
    }
    if (pair.separated) return
    const contact = pair.contact!
    const required = pair.required
    if (contact.distance >= required) return
    // Crossings require rerouting; this operation only opens existing gaps.
    if (contact.distance < 1e-10) return
    const weights = pair.weights
    weights[0]![1] = 1 - contact.s
    weights[1]![1] = contact.s
    weights[2]![1] = contact.t - 1
    weights[3]![1] = -contact.t
    this.project(
      weights,
      contact.x / contact.distance,
      contact.y / contact.distance,
      required - contact.distance,
      a.via && b.via,
    )
  }

  private projectPad(pad: PadContact): void {
    const { segment, corners, required } = pad
    const endpointCount = segment.a === segment.b ? 1 : 2
    for (let endpoint = 0; endpoint < endpointCount; endpoint++) {
      const vertex = endpoint === 0 ? segment.a : segment.b
      if (vertex.revision !== pad.interiorRevisions[endpoint]) {
        pad.interiors[endpoint] = getInteriorPadContact(vertex, corners)
        pad.interiorRevisions[endpoint] = vertex.revision
      }
      const interior = pad.interiors[endpoint]
      if (interior) {
        this.project(
          pad.endpointWeights[endpoint]!,
          interior.x,
          interior.y,
          required + interior.depth,
          false,
        )
      }
    }
    if (
      segment.a.revision !== pad.revisions[0] ||
      segment.b.revision !== pad.revisions[1]
    ) {
      let nearest = getContact(segment.a, segment.b, corners[0]!, corners[1]!)
      for (let i = 1; i < corners.length; i++) {
        const candidate = getContact(
          segment.a,
          segment.b,
          corners[i]!,
          corners[(i + 1) % corners.length]!,
        )
        // The original reduction selected the last edge at equal distance.
        nearest = nearest.distance < candidate.distance ? nearest : candidate
      }
      pad.contact = nearest
      pad.revisions[0] = segment.a.revision
      pad.revisions[1] = segment.b.revision
    }
    const contact = pad.contact!
    if (contact.distance < 1e-10) return
    if (contact.distance >= required) return
    pad.weights[0]![1] = 1 - contact.s
    pad.weights[1]![1] = contact.s
    this.project(
      pad.weights,
      contact.x / contact.distance,
      contact.y / contact.distance,
      required - contact.distance,
      false,
    )
  }

  private stepSweep(): void {
    let processed = 0
    while (processed < 4096 && this.sweepPairIndex < this.pairs.length) {
      this.projectPair(this.pairs[this.sweepPairIndex++]!)
      processed++
    }
    while (
      processed < 4096 &&
      this.sweepPairIndex === this.pairs.length &&
      this.sweepPadIndex < this.padContacts.length
    ) {
      this.projectPad(this.padContacts[this.sweepPadIndex++]!)
      processed++
    }
    this.projectedConstraintCount += processed
    if (
      this.sweepPairIndex === this.pairs.length &&
      this.sweepPadIndex === this.padContacts.length
    ) {
      this.sweepIndex++
      this.sweepPairIndex = 0
      this.sweepPadIndex = 0
      if (this.sweepIndex === MAX_SWEEPS) this.phase = "finalize"
    }
    this.progress = this.sweepIndex / (MAX_SWEEPS + 1)
    this.stats = {
      ...this.stats,
      sweepCount: this.sweepIndex,
      projectedConstraintCount: this.projectedConstraintCount,
      lastProjectedConstraintBatchCount: processed,
    }
  }

  private finalizeRoutes(): void {
    const { vertices, routes } = this
    for (const vertex of vertices.values()) {
      for (const point of vertex.points) {
        point.x = vertex.x
        point.y = vertex.y
      }
    }
    for (const route of routes) {
      route.vias = []
      for (let i = 1; i < route.route.length; i++) {
        const a = route.route[i - 1]!,
          b = route.route[i]!
        if (
          a.z !== b.z &&
          a.toNextSegmentType !== "through_obstacle" &&
          !route.vias.some((via) => via.x === b.x && via.y === b.y)
        ) {
          route.vias.push({ x: b.x, y: b.y })
        }
      }
    }

    this.solved = true
    this.progress = 1
  }

  override _step(): void {
    switch (this.phase) {
      case "geometry":
        return this.prepareGeometry()
      case "pairs":
        return this.preparePairs()
      case "obstacles":
        return this.prepareObstacles()
      case "sweeps":
        return this.stepSweep()
      case "finalize":
        return this.finalizeRoutes()
    }
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved || this.failed)
      throw new Error("Trace clearance projection is not complete")
    return this.routes
  }

  getResult(): HighDensityRoute[] {
    return this.getOutput()
  }
}
