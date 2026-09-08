import { BaseSolver } from "@tscircuit/solver-utils"
import { pointToSegmentDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute, HighDensityRoutePoint as RoutePoint } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { PadJunctionSearch } from "./PadJunctionSearch"

/** Domain vocabulary shared by the search, output, and debugger.
 * Parsed input: validated geometry and normalized options used by the solver.
 * Junction path: an ordered sequence of routing points.
 * Candidate progress: the current arm stage plus only its completed arms.
 * Target pad: rectangular conductive area receiving both routes.
 * Branch anchor: fixed end of the same-layer terminal run being replaced.
 * Trunk: the connection between the two branch anchors, through the junction.
 * Junction: the single point where the pad stem joins the trunk.
 * Pad stem: the shared connection from the junction to the pad entry.
 * Pad entry: a point inside the pad, inset by half the trace width.
 * Candidate: a proposed trunk, junction, and pad stem.
 * Fixed copper: all route segments outside the two replaceable terminal runs.
 * Clearance: minimum edge-to-edge separation from unrelated copper.
 * Search state: grid position and incoming direction.
 * Search frontier: discovered states awaiting expansion in a priority queue.
 * Search cost: lexicographic pair (bend count, copper length).
 * Heuristic estimate: (zero bends, Euclidean distance to the goal).
 * Search budget: maximum expanded states for one pad-junction problem.
 * Accepted replacement: a fully checked candidate improving the original cost.
 *
 * Scope: two equal-width, same-layer terminal runs at an axis-aligned pad.
 * Other layers and route metadata remain unchanged. Unsupported geometry is an
 * explicit no-op. A* finds shortest lexicographic paths on a bounded orthogonal
 * grid; sequential arm routing and first improvement do NOT guarantee a globally
 * optimal copper tree. Original endpoints are retained inside the conductive pad.
 */
export type PadJunctionPoint = { x: number; y: number; z: number }
export type JunctionPath = PadJunctionPoint[]
export type SearchDirection = "east" | "north" | "west" | "south"
export type TargetPad = Obstacle & { __zLayers: number[] }
type ParsedRoute = HighDensityRoute & {
  route: RoutePoint[]
  firstPoint: RoutePoint
  lastPoint: RoutePoint
}
export type BranchAnchor = {
  routeIndex: number
  route: ParsedRoute
  points: RoutePoint[]
  anchor: RoutePoint
  terminal: RoutePoint
  anchorIndex: number
  reversed: boolean
}
export type Trunk = [JunctionPath, JunctionPath]
export type Junction = PadJunctionPoint
export type PadStem = JunctionPath
export type PadEntry = PadJunctionPoint
export type Candidate = { trunk: Trunk; junction: Junction; padStem: PadStem }
export type FixedCopper = {
  start: PadJunctionPoint
  end: PadJunctionPoint
  width: number
  routeIndex: number
  sameNet: boolean
}
export type Clearance = number
export type SearchCost = { bends: number; length: number }
export type SearchState = {
  point: PadJunctionPoint
  direction: SearchDirection
  cost: SearchCost
  key: string
}
export type SearchFrontier = SearchState[]
export type HeuristicEstimate = SearchCost
export type SearchBudget = number
export type AcceptedReplacement = Candidate
export type PadJunctionOutcome = {
  outcome: "accepted" | "no_improvement" | "no_path" | "search_budget_reached" | "unsupported"
  reason: string
  connectionNames: string[]
}
export type PadJunctionSimplificationInput = {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  colorMap: Readonly<Record<string, string>>
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  minTraceToPadEdgeClearance?: number
  minBoardEdgeClearance?: number
  preserveRouteEndpoints?: boolean
  searchBudget?: SearchBudget
  gridStep?: number
}
type CandidateProgress =
  | { stage: "first_trunk"; junction: Junction }
  | { stage: "second_trunk"; junction: Junction; firstTrunk: JunctionPath }
  | { stage: "pad_stem"; junction: Junction; trunk: Trunk }
type ParsedInput = Omit<PadJunctionSimplificationInput,
  "hdRoutes" | "otherHdRoutes" | "obstacles" | "minTraceToPadEdgeClearance" |
  "minBoardEdgeClearance" | "searchBudget"> & {
  hdRoutes: ParsedRoute[]
  otherHdRoutes: ParsedRoute[]
  obstacles: TargetPad[]
  minTraceToPadEdgeClearance: number
  minBoardEdgeClearance: number
  searchBudget: number
}
type PadJunctionProblem = {
  targetPad: TargetPad
  branches: [BranchAnchor, BranchAnchor]
  width: number
  z: number
  originalCost: SearchCost
  fixedCopper: FixedCopper[]
  junctions: Junction[]
  junctionIndex: number
  currentCandidate: CandidateProgress | null
  search: PadJunctionSearch | null
  expanded: number
  foundValid: boolean
}
const EPSILON = 1e-7

/** Indexed geometry loops have runtime bounds that TypeScript cannot prove. */
function getItemOrThrow<T>(items: ReadonlyArray<T>, index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`PadJunctionSimplificationSolver: missing item at index ${index}`)
  }
  return item
}

/** Parsing boundary: validate external geometry and construct nonempty routes.
 * Parsed routes carry their endpoints, so internal routing never guesses whether
 * a terminal exists. Metadata is preserved until output removes these caches.
 */
function parseRoute(route: HighDensityRoute, layerCount: number): ParsedRoute {
  const points = route.route.map((point): RoutePoint => ({ ...point }))
  const [firstPoint] = points
  const lastPoint = points.at(-1)
  const invalidPoint = points.some((point) =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount ||
    (point.traceThickness !== undefined &&
      (!Number.isFinite(point.traceThickness) || point.traceThickness <= 0)),
  )
  const invalidVia = route.vias.some((via) =>
    !Number.isFinite(via.x) || !Number.isFinite(via.y))
  if (!firstPoint || !lastPoint || invalidPoint || invalidVia ||
    !Number.isFinite(route.traceThickness) || route.traceThickness <= 0 ||
    !Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0) {
    throw new Error(`PadJunctionSimplificationSolver: invalid route "${route.connectionName}"`)
  }
  return {
    ...route, route: points, firstPoint, lastPoint,
    vias: route.vias.map((via) => ({ ...via })),
  }
}

function parsePadJunctionInput(input: PadJunctionSimplificationInput): ParsedInput {
  const clearance = input.minTraceToPadEdgeClearance ?? 0.15
  const boardClearance = input.minBoardEdgeClearance ?? 0
  const searchBudget = input.searchBudget ?? 20000
  if (!Number.isInteger(input.layerCount) || input.layerCount < 1 ||
    !Number.isFinite(clearance) || clearance < 0 ||
    !Number.isFinite(boardClearance) || boardClearance < 0 ||
    (input.gridStep !== undefined && (!Number.isFinite(input.gridStep) || input.gridStep <= 0)) ||
    !Number.isInteger(searchBudget) || searchBudget < 1) {
    throw new Error("PadJunctionSimplificationSolver: invalid layers, clearance, grid step, or search budget")
  }
  if (input.bounds) {
    const { minX, minY, maxX, maxY } = input.bounds
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
      throw new Error("PadJunctionSimplificationSolver: invalid board bounds")
    }
  }
  if (input.outline && (input.outline.length < 3 || input.outline.some((point) =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y)))) {
    throw new Error("PadJunctionSimplificationSolver: invalid board outline")
  }
  for (const obstacle of input.obstacles) {
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0 ||
      (obstacle.ccwRotationDegrees !== undefined && !Number.isFinite(obstacle.ccwRotationDegrees)) ||
      ("shape" in obstacle && obstacle.shape !== undefined && typeof obstacle.shape !== "string")) {
      throw new Error(`PadJunctionSimplificationSolver: invalid obstacle "${obstacle.obstacleId}"`)
    }
    for (const layers of [obstacle.__zLayers, obstacle.zLayers]) {
      if (layers && (layers.length === 0 || layers.some((z) =>
        !Number.isInteger(z) || z < 0 || z >= input.layerCount))) {
        throw new Error(`PadJunctionSimplificationSolver: invalid obstacle layers "${obstacle.obstacleId}"`)
      }
    }
  }
  const obstacles = createObjectsWithZLayers(input.obstacles, input.layerCount)
    .map((obstacle): TargetPad => ({
      ...obstacle,
      center: { ...obstacle.center },
      connectedTo: [...obstacle.connectedTo],
    }))
  return {
    ...input,
    hdRoutes: input.hdRoutes.map((route) => parseRoute(route, input.layerCount)),
    otherHdRoutes: (input.otherHdRoutes ?? []).map((route) => parseRoute(route, input.layerCount)),
    obstacles, minTraceToPadEdgeClearance: clearance,
    minBoardEdgeClearance: boardClearance, searchBudget,
    bounds: input.bounds ? { ...input.bounds } : undefined,
    outline: input.outline?.map((point) => ({ ...point })),
  }
}


export function getPathCost(points: ReadonlyArray<PadJunctionPoint>): SearchCost {
  let length = 0
  let bends = 0
  for (let index = 1; index < points.length; index++) {
    const start = getItemOrThrow(points, index - 1)
    const end = getItemOrThrow(points, index)
    length += Math.hypot(end.x - start.x, end.y - start.y)
    if (index < 2) continue
    const previous = getItemOrThrow(points, index - 2)
    const cross = (start.x - previous.x) * (end.y - start.y) - (start.y - previous.y) * (end.x - start.x)
    const dot = (start.x - previous.x) * (end.x - start.x) + (start.y - previous.y) * (end.y - start.y)
    if (Math.abs(cross) > EPSILON || dot < 0) bends++
  }
  return { bends, length }
}

export function simplifyJunctionPath(points: PadJunctionPoint[]): PadJunctionPoint[] {
  const result: PadJunctionPoint[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < EPSILON) continue
    result.push(point)
    while (result.length >= 3 && getPathCost(result.slice(-3)).bends === 0) {
      result.splice(result.length - 2, 1)
    }
  }
  return result
}

export class PadJunctionSimplificationSolver extends BaseSolver {
  readonly outcomes: PadJunctionOutcome[] = []
  expandedStateCount = 0
  acceptedReplacement: AcceptedReplacement | null = null
  private readonly output: ParsedRoute[]
  private readonly obstacles: TargetPad[]
  private obstacleIndex = 0
  private readonly lockedRouteIndices = new Set<number>()
  private problem: PadJunctionProblem | null = null
  private readonly clearance: Clearance

  private readonly parsed: ParsedInput

  constructor(private readonly input: PadJunctionSimplificationInput) {
    super()
    // Parse once at the boundary. Geometry and search only consume this model.
    this.parsed = parsePadJunctionInput(input)
    this.clearance = this.parsed.minTraceToPadEdgeClearance
    this.obstacles = this.parsed.obstacles
    this.output = [...this.parsed.hdRoutes]
    this.MAX_ITERATIONS = 100e6
  }

  /** Route identities may name a member ID or a net key from ConnectivityMap. */
  private getNetForIdentity(identity: string): string | undefined {
    const memberNet = this.parsed.connMap.getNetConnectedToId(identity)
    if (memberNet !== undefined) return memberNet
    const [member] = this.parsed.connMap.getIdsConnectedToNet(identity)
    return member === undefined
      ? undefined
      : this.parsed.connMap.getNetConnectedToId(member)
  }

  private isConnected(route: HighDensityRoute, connectedId: string): boolean {
    const identities = [route.connectionName]
    if (route.rootConnectionName) identities.push(route.rootConnectionName)
    const connectedNet = this.getNetForIdentity(connectedId)
    for (const identity of identities) {
      if (identity === connectedId) return true
      if (connectedNet !== undefined && this.getNetForIdentity(identity) === connectedNet) return true
    }
    return false
  }

  private routesAreConnected(left: HighDensityRoute, right: HighDensityRoute): boolean {
    const identities = [right.connectionName]
    if (right.rootConnectionName) identities.push(right.rootConnectionName)
    return identities.some((identity) => this.isConnected(left, identity))
  }

  private insidePad(point: PadJunctionPoint, pad: TargetPad, inset = 0): boolean {
    const halfWidth = pad.width / 2 - inset
    const halfHeight = pad.height / 2 - inset
    return pad.__zLayers.includes(point.z) && halfWidth >= 0 && halfHeight >= 0 &&
      Math.abs(point.x - pad.center.x) <= halfWidth + EPSILON &&
      Math.abs(point.y - pad.center.y) <= halfHeight + EPSILON
  }

  private createProblem(targetPad: TargetPad): PadJunctionProblem | null {
    const discoveredBranches: BranchAnchor[] = []
    for (const [routeIndex, route] of this.output.entries()) {
      if (route.route.length < 2) continue
      if (!targetPad.connectedTo.some((identity) => this.isConnected(route, identity))) continue
      const startInside = this.insidePad(route.firstPoint, targetPad)
      const endInside = this.insidePad(route.lastPoint, targetPad)
      if (startInside === endInside) continue
      const points = startInside ? [...route.route].reverse() : [...route.route]
      const terminal = startInside ? route.firstPoint : route.lastPoint
      let anchorIndex = points.length - 1
      while (anchorIndex > 0 && getItemOrThrow(points, anchorIndex - 1).z === terminal.z) anchorIndex--
      if (anchorIndex === points.length - 1) continue
      discoveredBranches.push({ routeIndex, route, points, anchor: getItemOrThrow(points, anchorIndex), terminal, anchorIndex, reversed: startInside })
    }
    const [firstBranch, secondBranch] = discoveredBranches
    if (discoveredBranches.length !== 2 || !firstBranch || !secondBranch) return null
    const branches: [BranchAnchor, BranchAnchor] = [firstBranch, secondBranch]
    const connectionNames = branches.map((branch) => branch.route.connectionName)
    if (branches.some((branch) => this.lockedRouteIndices.has(branch.routeIndex))) {
      this.outcomes.push({
        outcome: "unsupported", connectionNames,
        reason: "A route already belongs to an accepted pad-junction replacement",
      })
      return null
    }
    const width = branches[0].route.traceThickness
    const z = branches[0].terminal.z
    const unsupported = targetPad.type !== "rect" ||
      ("shape" in targetPad && targetPad.shape !== undefined && targetPad.shape !== "rect") ||
      targetPad.ccwRotationDegrees || targetPad.isCopperPour ||
      targetPad.width <= width || targetPad.height <= width ||
      branches.some((branch) => {
        const route = branch.route
        return route.traceThickness !== width || branch.terminal.z !== z || Boolean(route.jumpers?.length) ||
          route.route.some((point) => point.toNextSegmentType ||
            point.insideJumperPad ||
            (point.traceThickness !== undefined && point.traceThickness !== width))
      }) || this.obstacles.some((obstacle) => obstacle.__zLayers.includes(z) && Boolean(obstacle.ccwRotationDegrees))
    if (unsupported) {
      this.outcomes.push({
        outcome: "unsupported",
        reason: "Requires axis-aligned pads and equal, constant-width terminal runs without jumpers or through-obstacle segments",
        connectionNames,
      })
      return null
    }
    const first = simplifyJunctionPath(branches[0].points.slice(branches[0].anchorIndex))
    const second = simplifyJunctionPath(branches[1].points.slice(branches[1].anchorIndex))
    let sharedCount = 0
    while (sharedCount < Math.min(first.length, second.length)) {
      const a = getItemOrThrow(first, first.length - 1 - sharedCount)
      const b = getItemOrThrow(second, second.length - 1 - sharedCount)
      if (Math.hypot(a.x - b.x, a.y - b.y) > EPSILON) break
      sharedCount++
    }
    const firstTrunk = first.slice(0, first.length - Math.max(0, sharedCount - 1))
    const secondTrunk = second.slice(0, second.length - Math.max(0, sharedCount - 1))
    const originalTrunk = simplifyJunctionPath([...firstTrunk, ...[...secondTrunk].reverse()])
    const originalCost = getPathCost(originalTrunk)
    if (sharedCount > 1) {
      const sharedStem = first.slice(first.length - sharedCount)
      const entryIndex = sharedStem.findIndex((point) => this.insidePad(point, targetPad, width / 2))
      const exteriorStem = sharedStem.slice(0, entryIndex >= 0 ? entryIndex + 1 : sharedStem.length)
      if (entryIndex > 0) {
        const start = getItemOrThrow(sharedStem, entryIndex - 1)
        const end = getItemOrThrow(sharedStem, entryIndex)
        let fraction = 0
        const axes: ("x" | "y")[] = ["x", "y"]
        for (const axis of axes) {
          const halfSize = (axis === "x" ? targetPad.width : targetPad.height) / 2 - width / 2
          const minimum = targetPad.center[axis] - halfSize
          const maximum = targetPad.center[axis] + halfSize
          if (start[axis] < minimum) {
            fraction = Math.max(fraction, (minimum - start[axis]) / (end[axis] - start[axis]))
          } else if (start[axis] > maximum) {
            fraction = Math.max(fraction, (maximum - start[axis]) / (end[axis] - start[axis]))
          }
        }
        exteriorStem[exteriorStem.length - 1] = {
          x: start.x + fraction * (end.x - start.x),
          y: start.y + fraction * (end.y - start.y),
          z,
        }
      }
      const stemCost = getPathCost(exteriorStem)
      originalCost.bends += stemCost.bends
      originalCost.length += stemCost.length
    }
    const fixedCopper: FixedCopper[] = []
    for (const [routeIndex, route] of [...this.output, ...this.parsed.otherHdRoutes].entries()) {
      const branch = branches.find((candidate) => candidate.routeIndex === routeIndex)
      const sameNet = this.routesAreConnected(branches[0].route, route)
      const points = branch ? branch.points.slice(0, branch.anchorIndex + 1) : route.route
      for (let index = 1; index < points.length; index++) {
        if (getItemOrThrow(points, index - 1).z !== z || getItemOrThrow(points, index).z !== z) continue
        fixedCopper.push({
          start: getItemOrThrow(points, index - 1), end: getItemOrThrow(points, index), routeIndex, sameNet,
          width: getItemOrThrow(points, index - 1).traceThickness ?? route.traceThickness,
        })
      }
      for (const via of route.vias) {
        fixedCopper.push({ start: { ...via, z }, end: { ...via, z }, width: route.viaDiameter, routeIndex, sameNet })
      }
    }
    // Moving a terminal run must not remove an existing interior copper tap.
    for (const branch of branches) {
      const points = branch.points.slice(branch.anchorIndex)
      const anchor = branch.anchor
      for (let index = 1; index < points.length; index++) {
        const start = getItemOrThrow(points, index - 1)
        const end = getItemOrThrow(points, index)
        for (const copper of fixedCopper) {
          if (!copper.sameNet) continue
          const distance = minimumDistanceBetweenSegments(start, end, copper.start, copper.end)
          if (distance > (width + copper.width) / 2 + EPSILON) continue
          if (this.insidePad(start, targetPad) && this.insidePad(end, targetPad)) continue
          const copperTouchesAnchor = [copper.start, copper.end].some((point) =>
            Math.hypot(point.x - anchor.x, point.y - anchor.y) < EPSILON)
          const hasOtherTap = [copper.start, copper.end].some((point) =>
            !this.insidePad(point, targetPad) &&
            Math.hypot(point.x - anchor.x, point.y - anchor.y) > EPSILON &&
            pointToSegmentDistance(point, start, end) < (width + copper.width) / 2)
          if (copperTouchesAnchor && !hasOtherTap) continue
          this.outcomes.push({
            outcome: "unsupported", connectionNames,
            reason: "A replaceable terminal run has a fixed-copper interior tap",
          })
          return null
        }
        for (const obstacle of this.obstacles) {
          if (obstacle === targetPad || !obstacle.__zLayers.includes(z) ||
            this.insidePad(anchor, obstacle)) continue
          const sameNet = obstacle.connectedTo.some((identity) =>
            this.isConnected(branch.route, identity))
          if (!sameNet || segmentToBoxMinDistance(start, end, obstacle) > width / 2) continue
          this.outcomes.push({
            outcome: "unsupported", connectionNames,
            reason: "A replaceable terminal run touches another connected pad",
          })
          return null
        }
      }
    }
    return {
      targetPad,
      branches: [branches[0], branches[1]],
      width, z, originalCost, fixedCopper,
      junctions: [],
      junctionIndex: 0,
      currentCandidate: null,
      search: null,
      expanded: 0,
      foundValid: false,
    }
  }

  private segmentIsClear(problem: PadJunctionProblem, start: PadJunctionPoint, end: PadJunctionPoint): boolean {
    for (const obstacle of this.obstacles) {
      if (!obstacle.__zLayers.includes(problem.z) || obstacle === problem.targetPad) continue
      const ownPad = obstacle.connectedTo.some((identity) => this.isConnected(problem.branches[0].route, identity))
      if (ownPad && problem.branches.some((branch) => this.insidePad(branch.anchor, obstacle))) continue
      if (segmentToBoxMinDistance(start, end, obstacle) < problem.width / 2 + this.clearance - EPSILON) return false
    }
    for (const copper of problem.fixedCopper) {
      // Same-net fixed copper may share a preserved anchor, including a peer route.
      const joinsOwnContinuation = problem.branches.some((branch) => {
        if (!copper.sameNet) return false
        const anchor = branch.anchor
        const replacementTouches =
          Math.hypot(anchor.x - start.x, anchor.y - start.y) < EPSILON ||
          Math.hypot(anchor.x - end.x, anchor.y - end.y) < EPSILON
        const continuationTouches =
          Math.hypot(anchor.x - copper.start.x, anchor.y - copper.start.y) < EPSILON ||
          Math.hypot(anchor.x - copper.end.x, anchor.y - copper.end.y) < EPSILON
        return replacementTouches && continuationTouches
      })
      if (joinsOwnContinuation) continue
      const distance = minimumDistanceBetweenSegments(start, end, copper.start, copper.end)
      if (distance < (problem.width + copper.width) / 2 + this.clearance - EPSILON) return false
    }
    // An explicit outline is authoritative; SRJ bounds describe rectangular boards.
    if (!this.parsed.outline && this.parsed.bounds) {
      const bounds = this.parsed.bounds
      const margin = problem.width / 2 + this.parsed.minBoardEdgeClearance
      for (const point of [start, end]) {
        if (point.x < bounds.minX + margin - EPSILON ||
          point.x > bounds.maxX - margin + EPSILON ||
          point.y < bounds.minY + margin - EPSILON ||
          point.y > bounds.maxY - margin + EPSILON) return false
      }
    }
    if (this.parsed.outline) {
      const outline = [...this.parsed.outline]
      if (!isPointInOrOnPolygon(start, outline) || !isPointInOrOnPolygon(end, outline)) return false
      for (let index = 0; index < outline.length; index++) {
        const distance = minimumDistanceBetweenSegments(
          start, end, getItemOrThrow(outline, index), getItemOrThrow(outline, (index + 1) % outline.length),
        )
        const margin = problem.width / 2 + this.parsed.minBoardEdgeClearance
        if (distance < margin - EPSILON) return false
      }
    }
    return true
  }

  private candidateIsValid(problem: PadJunctionProblem, candidate: Candidate): boolean {
    for (const arm of candidate.trunk) {
      for (let index = 1; index < arm.length; index++) {
        if (segmentToBoxMinDistance(getItemOrThrow(arm, index - 1), getItemOrThrow(arm, index), problem.targetPad) <
          problem.width / 2 - EPSILON) return false
      }
    }
    const arms = [...candidate.trunk, candidate.padStem]
    if (arms.some((arm) => arm.length < 2)) return false
    for (const arm of arms) {
      for (let index = 1; index < arm.length; index++) {
        if (!this.segmentIsClear(problem, getItemOrThrow(arm, index - 1), getItemOrThrow(arm, index))) return false
        for (let other = 1; other < index - 1; other++) {
          if (minimumDistanceBetweenSegments(getItemOrThrow(arm, index - 1), getItemOrThrow(arm, index), getItemOrThrow(arm, other - 1), getItemOrThrow(arm, other)) < EPSILON) return false
        }
      }
    }
    // Arms may meet only at the common junction. Check non-adjacent segments as well.
    for (let first = 0; first < arms.length; first++) {
      for (let second = first + 1; second < arms.length; second++) {
        const firstArm = getItemOrThrow(arms, first)
        const secondArm = getItemOrThrow(arms, second)
        for (let a = 1; a < firstArm.length; a++) {
          for (let b = 1; b < secondArm.length; b++) {
            if (a === 1 && b === 1) {
              const p = getItemOrThrow(firstArm, 1)
              const q = getItemOrThrow(secondArm, 1)
              const junction = candidate.junction
              const cross = (p.x - junction.x) * (q.y - junction.y) - (p.y - junction.y) * (q.x - junction.x)
              const dot = (p.x - junction.x) * (q.x - junction.x) + (p.y - junction.y) * (q.y - junction.y)
              if (Math.abs(cross) < EPSILON && dot > 0) return false
              continue
            }
            const distance = minimumDistanceBetweenSegments(
              getItemOrThrow(firstArm, a - 1), getItemOrThrow(firstArm, a),
              getItemOrThrow(secondArm, b - 1), getItemOrThrow(secondArm, b),
            )
            if (distance < EPSILON) return false
          }
        }
      }
    }
    return this.insidePad(getItemOrThrow(candidate.padStem, candidate.padStem.length - 1), problem.targetPad, problem.width / 2)
  }

  private acceptCandidate(problem: PadJunctionProblem, candidate: Candidate): boolean {
    if (!this.candidateIsValid(problem, candidate)) return false
    problem.foundValid = true
    const trunk = [...candidate.trunk[0]].reverse().concat(candidate.trunk[1].slice(1))
    const trunkCost = getPathCost(simplifyJunctionPath(trunk))
    const stemCost = getPathCost(candidate.padStem)
    const cost = { bends: trunkCost.bends + stemCost.bends, length: trunkCost.length + stemCost.length }
    const improvesCost = cost.bends < problem.originalCost.bends ||
      (cost.bends === problem.originalCost.bends &&
        cost.length < problem.originalCost.length - EPSILON)
    if (!improvesCost) return false
    const replacements: ParsedRoute[] = []
    for (const [index, branch] of problem.branches.entries()) {
      const route = branch.route
      const terminal = branch.terminal
      const padEntry = getItemOrThrow(candidate.padStem, candidate.padStem.length - 1)
      if (!this.segmentIsClear(problem, padEntry, terminal)) return false
      const local = simplifyJunctionPath([...getItemOrThrow(candidate.trunk, index)].reverse().concat(candidate.padStem.slice(1)))
      // Retain the terminal identity and exact original endpoint; the tail is pad copper.
      const points = [...branch.points.slice(0, branch.anchorIndex), { ...branch.anchor }, ...local.slice(1)]
      if (Math.hypot(padEntry.x - terminal.x, padEntry.y - terminal.y) > EPSILON) points.push({ ...terminal })
      else points[points.length - 1] = { ...terminal }
      const orderedPoints = branch.reversed ? points.reverse() : points
      const firstPoint = getItemOrThrow(orderedPoints, 0)
      const lastPoint = getItemOrThrow(orderedPoints, orderedPoints.length - 1)
      replacements.push({
        ...route, route: orderedPoints, firstPoint, lastPoint,
      })
    }
    for (const [index, branch] of problem.branches.entries()) {
      this.output[branch.routeIndex] = getItemOrThrow(replacements, index)
      this.lockedRouteIndices.add(branch.routeIndex)
    }
    this.acceptedReplacement = candidate
    this.finishProblem("accepted", "Validated improvement; shared pad stem is represented in both point-to-point routes")
    return true
  }

  private initializeSearch(problem: PadJunctionProblem): void {
    const first = problem.branches[0].anchor
    const second = problem.branches[1].anchor
    const pad = problem.targetPad
    const dx = second.x - first.x
    const dy = second.y - first.y
    const squaredLength = dx * dx + dy * dy
    if (squaredLength < EPSILON) {
      this.finishProblem("no_improvement", "Branch anchors coincide")
      return
    }
    const fraction = ((pad.center.x - first.x) * dx + (pad.center.y - first.y) * dy) / squaredLength
    const junction = { x: first.x + fraction * dx, y: first.y + fraction * dy, z: problem.z }
    // Intersect the perpendicular junction-to-center ray with inset pad copper.
    // Coordinate-wise clamping would tilt a diagonal stem toward a pad corner.
    const offsetX = junction.x - pad.center.x
    const offsetY = junction.y - pad.center.y
    const halfWidth = (pad.width - problem.width) / 2
    const halfHeight = (pad.height - problem.width) / 2
    const rayFraction = Math.min(
      1,
      Math.abs(offsetX) > EPSILON ? halfWidth / Math.abs(offsetX) : 1,
      Math.abs(offsetY) > EPSILON ? halfHeight / Math.abs(offsetY) : 1,
    )
    const padEntry = {
      x: pad.center.x + offsetX * rayFraction,
      y: pad.center.y + offsetY * rayFraction,
      z: problem.z,
    }
    if (fraction > 0 && fraction < 1 && !this.insidePad(junction, pad)) {
      const direct: Candidate = { junction, trunk: [[junction, first], [junction, second]], padStem: [junction, padEntry] }
      if (this.acceptCandidate(problem, direct)) return
      if (problem.foundValid && problem.originalCost.bends === 0 &&
        (Math.abs(dx) < EPSILON || Math.abs(dy) < EPSILON)) {
        this.finishProblem("no_improvement", "Existing connection matches the straight, minimum-length T")
        return
      }
    }
    const step = this.parsed.gridStep ?? Math.max(problem.width, 0.25)
    const margin = Math.max(pad.width, pad.height, step * 4)
    const minX = Math.min(first.x, second.x, pad.center.x) - margin
    const maxX = Math.max(first.x, second.x, pad.center.x) + margin
    const minY = Math.min(first.y, second.y, pad.center.y) - margin
    const maxY = Math.max(first.y, second.y, pad.center.y) + margin
    const count = Math.ceil((maxX - minX) / step) * Math.ceil((maxY - minY) / step)
    if (count > 20000) {
      this.finishProblem("search_budget_reached", "Requested grid exceeds 20000 junction positions; choose a coarser grid")
      return
    }
    for (let x = minX; x <= maxX + EPSILON; x += step) {
      for (let y = minY; y <= maxY + EPSILON; y += step) {
        const position = { x, y, z: problem.z }
        if (this.insidePad(position, pad) || !this.segmentIsClear(problem, position, position)) continue
        // A T requires anchors on opposite sides of one junction axis.
        if ((first.x - x) * (second.x - x) >= 0 && (first.y - y) * (second.y - y) >= 0) continue
        problem.junctions.push(position)
      }
    }
    problem.junctions.sort((a, b) => Math.hypot(a.x - junction.x, a.y - junction.y) - Math.hypot(b.x - junction.x, b.y - junction.y))
  }

  private finishProblem(outcome: PadJunctionOutcome["outcome"], reason: string): void {
    if (!this.problem) throw new Error("PadJunctionSimplificationSolver: missing active problem")
    this.outcomes.push({
      outcome, reason,
      connectionNames: this.problem.branches.map((branch) =>
        branch.route.connectionName),
    })
    this.stats = { expandedStates: this.expandedStateCount, outcome, reason }
    this.problem = null
  }

  override _step(): void {
    if (!this.problem) {
      if (this.obstacleIndex >= this.obstacles.length) {
        this.solved = true
        return
      }
      this.problem = this.createProblem(getItemOrThrow(this.obstacles, this.obstacleIndex++))
      if (this.problem) this.initializeSearch(this.problem)
      return
    }
    const problem = this.problem
    if (problem.expanded >= this.parsed.searchBudget) {
      this.finishProblem("search_budget_reached", "Expanded-state budget reached without an accepted improvement")
      return
    }
    if (!problem.currentCandidate) {
      const junction = problem.junctions[problem.junctionIndex++]
      if (!junction) {
        this.finishProblem(problem.foundValid ? "no_improvement" : "no_path", "Bounded junction search exhausted")
        return
      }
      problem.currentCandidate = { stage: "first_trunk", junction }
    }
    const candidate = problem.currentCandidate
    const completedArms: JunctionPath[] = candidate.stage === "first_trunk" ? []
      : candidate.stage === "second_trunk" ? [candidate.firstTrunk] : candidate.trunk
    if (!problem.search) {
      const first = problem.branches[0].anchor
      const second = problem.branches[1].anchor
      const horizontalTrunk = (first.x - candidate.junction.x) * (second.x - candidate.junction.x) < 0
      const anchor = candidate.stage === "first_trunk" ? first
        : candidate.stage === "second_trunk" ? second : null
      // Choose the initial direction toward the anchor or perpendicular pad stem.
      let direction: SearchDirection
      if (anchor) {
        direction = horizontalTrunk
          ? (anchor.x < candidate.junction.x ? "west" : "east")
          : (anchor.y < candidate.junction.y ? "south" : "north")
      } else {
        direction = horizontalTrunk
          ? (problem.targetPad.center.y < candidate.junction.y ? "south" : "north")
          : (problem.targetPad.center.x < candidate.junction.x ? "west" : "east")
      }
      problem.search = new PadJunctionSearch({
        start: candidate.junction,
        goal: anchor ? { kind: "anchor", point: anchor } : { kind: "pad" },
        pad: problem.targetPad, width: problem.width,
        anchors: [first, second], gridStep: this.parsed.gridStep ?? Math.max(problem.width, 0.25), direction,
        segmentIsClear: (start, end): boolean => {
          if (!this.segmentIsClear(problem, start, end)) return false
          if (candidate.stage !== "pad_stem" &&
            segmentToBoxMinDistance(start, end, problem.targetPad) < problem.width / 2 - EPSILON) return false
          for (const arm of completedArms) {
            for (let index = 1; index < arm.length; index++) {
              if (index === 1 && Math.hypot(start.x - candidate.junction.x, start.y - candidate.junction.y) < EPSILON) continue
              if (minimumDistanceBetweenSegments(start, end, getItemOrThrow(arm, index - 1), getItemOrThrow(arm, index)) < EPSILON) return false
            }
          }
          return true
        },
      })
    }
    problem.search.step()
    problem.expanded++
    this.expandedStateCount++
    this.stats = { expandedStates: this.expandedStateCount, junctionsTried: problem.junctionIndex, arm: completedArms.length }
    const result = problem.search.result
    if (result.status === "searching") return
    problem.search = null
    if (result.status === "no_path") {
      problem.currentCandidate = null
      return
    }
    switch (candidate.stage) {
      case "first_trunk":
        problem.currentCandidate = { stage: "second_trunk", junction: candidate.junction, firstTrunk: result.path }
        return
      case "second_trunk":
        problem.currentCandidate = { stage: "pad_stem", junction: candidate.junction, trunk: [candidate.firstTrunk, result.path] }
        return
      case "pad_stem": {
        const complete: Candidate = { junction: candidate.junction, trunk: candidate.trunk, padStem: result.path }
        if (!this.acceptCandidate(problem, complete)) problem.currentCandidate = null
        return
      }
      default: {
        const unexpectedStage: never = candidate
        throw new Error(`PadJunctionSimplificationSolver: unknown candidate stage ${unexpectedStage}`)
      }
    }
  }

  override getConstructorParams(): [PadJunctionSimplificationInput] {
    return [this.input]
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("PadJunctionSimplificationSolver: output requested before completion")
    return this.output.map(({ firstPoint, lastPoint, ...route }): HighDensityRoute => route)
  }

  override visualize(): GraphicsObject {
    const lines: Line[] = []
    const points: Point[] = []
    const rects: Rect[] = []
    const graphics: GraphicsObject = {
      title: `Pad junction simplification: ${this.expandedStateCount} expanded states`,
      coordinateSystem: "cartesian",
      lines, points, rects,
    }
    for (const obstacle of this.obstacles) {
      rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255,0,0,0.15)",
        label: obstacle === this.problem?.targetPad ? "Target pad" : "Obstacle",
      })
    }
    const routeLayers: { original: boolean; routes: ParsedRoute[] }[] = [
      { original: true, routes: this.parsed.hdRoutes }, { original: false, routes: this.output },
    ]
    for (const { original, routes } of routeLayers) {
      for (const route of routes) {
        for (let index = 1; index < route.route.length; index++) {
          const start = getItemOrThrow(route.route, index - 1)
          const end = getItemOrThrow(route.route, index)
          if (start.z !== end.z) continue
          lines.push({
            points: [start, end],
            strokeColor: original
              ? "rgba(128,128,128,0.3)"
              : this.parsed.colorMap[route.connectionName] ?? "red",
            strokeWidth: route.traceThickness,
            strokeDash: original || start.z !== 0 ? [0.08, 0.08] : undefined,
            layer: `z${start.z}`,
            label: original ? "Original connection" : route.connectionName,
          })
        }
      }
    }
    const candidate = this.problem?.currentCandidate ?? this.acceptedReplacement
    if (candidate) {
      points.push({ ...candidate.junction, color: "teal", label: "Junction" })
      const arms: JunctionPath[] = "stage" in candidate
        ? candidate.stage === "first_trunk" ? []
          : candidate.stage === "second_trunk" ? [candidate.firstTrunk] : candidate.trunk
        : [...candidate.trunk, candidate.padStem]
      for (const arm of arms) {
        lines.push({
          points: arm, strokeColor: "teal", strokeWidth: this.problem?.width ?? 0.1,
        })
      }
    }
    if (this.problem) {
      for (const branch of this.problem.branches) {
        points.push({
          ...branch.anchor, color: "blue", label: "Branch anchor",
        })
      }
      for (const point of this.problem.search?.expandedPoints ?? []) points.push({ ...point, color: "rgba(0,128,128,0.3)" })
      for (const point of this.problem.search?.frontierPoints ?? []) points.push({ ...point, color: "orange" })
    }
    return graphics
  }
}
