import { BaseSolver } from "@tscircuit/solver-utils"
import { pointToSegmentDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { PadJunctionSearch } from "./PadJunctionSearch"

/** Domain vocabulary shared by the search, output, and debugger.
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
export type TargetPad = Obstacle & { __zLayers: number[] }
export type BranchAnchor = {
  routeIndex: number
  points: HighDensityRoute["route"]
  anchorIndex: number
  reversed: boolean
}
export type Trunk = [PadJunctionPoint[], PadJunctionPoint[]]
export type Junction = PadJunctionPoint
export type PadStem = PadJunctionPoint[]
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
  direction: number
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
  netByConnectionName?: ReadonlyMap<string, string>
  preserveRouteEndpoints?: boolean
  searchBudget?: SearchBudget
  gridStep?: number
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
  currentCandidate: Candidate | null
  armIndex: number
  search: PadJunctionSearch | null
  expanded: number
  foundValid: boolean
}
const EPSILON = 1e-7

export function getPathCost(points: ReadonlyArray<PadJunctionPoint>): SearchCost {
  let length = 0
  let bends = 0
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]
    const end = points[index]
    length += Math.hypot(end.x - start.x, end.y - start.y)
    if (index < 2) continue
    const previous = points[index - 2]
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
  private readonly output: HighDensityRoute[]
  private readonly obstacles: TargetPad[]
  private obstacleIndex = 0
  private readonly lockedRouteIndices = new Set<number>()
  private problem: PadJunctionProblem | null = null
  private readonly clearance: Clearance

  constructor(private readonly input: PadJunctionSimplificationInput) {
    super()
    this.clearance = input.minTraceToPadEdgeClearance ?? 0.15
    if (!Number.isFinite(this.clearance) || this.clearance < 0 ||
      (input.gridStep !== undefined && (!Number.isFinite(input.gridStep) || input.gridStep <= 0)) ||
      (input.searchBudget !== undefined && (!Number.isInteger(input.searchBudget) || input.searchBudget < 1))) {
      throw new Error("PadJunctionSimplificationSolver: invalid clearance, grid step, or search budget")
    }
    if (input.bounds) {
      const { minX, minY, maxX, maxY } = input.bounds
      if (![minX, minY, maxX, maxY].every(Number.isFinite) ||
        minX >= maxX || minY >= maxY) {
        throw new Error("PadJunctionSimplificationSolver: invalid board bounds")
      }
    }
    this.obstacles = createObjectsWithZLayers(input.obstacles, input.layerCount)
    this.output = input.hdRoutes.map((route) => ({
      ...route,
      route: route.route.map((point) => ({ ...point })),
      vias: route.vias.map((via) => ({ ...via })),
    }))
    for (const route of this.output) {
      const invalidPoint = route.route.some((point) =>
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        !Number.isInteger(point.z),
      )
      if (route.route.length === 0 || !Number.isFinite(route.traceThickness) ||
        route.traceThickness <= 0 || invalidPoint) {
        throw new Error(`PadJunctionSimplificationSolver: invalid route "${route.connectionName}"`)
      }
    }
    this.MAX_ITERATIONS = 100e6
  }

  private isConnected(route: HighDensityRoute, connectedId: string): boolean {
    const identities = [route.connectionName]
    if (route.rootConnectionName) identities.push(route.rootConnectionName)
    const net = this.input.netByConnectionName?.get(route.connectionName)
    if (net) identities.push(net)
    for (const identity of identities) {
      if (identity === connectedId || this.input.connMap.areIdsConnected(identity, connectedId)) return true
    }
    return false
  }

  private routesAreConnected(left: HighDensityRoute, right: HighDensityRoute): boolean {
    const identities = [right.connectionName]
    if (right.rootConnectionName) identities.push(right.rootConnectionName)
    const net = this.input.netByConnectionName?.get(right.connectionName)
    if (net) identities.push(net)
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
    const branches: BranchAnchor[] = []
    for (let routeIndex = 0; routeIndex < this.output.length; routeIndex++) {
      const route = this.output[routeIndex]
      if (route.route.length < 2) continue
      if (!targetPad.connectedTo.some((identity) => this.isConnected(route, identity))) continue
      const startInside = this.insidePad(route.route[0], targetPad)
      const endInside = this.insidePad(route.route.at(-1)!, targetPad)
      if (startInside === endInside) continue
      const points = startInside ? [...route.route].reverse() : [...route.route]
      let anchorIndex = points.length - 1
      while (anchorIndex > 0 && points[anchorIndex - 1].z === points.at(-1)!.z) anchorIndex--
      if (anchorIndex === points.length - 1) continue
      branches.push({ routeIndex, points, anchorIndex, reversed: startInside })
    }
    if (branches.length !== 2) return null
    const connectionNames = branches.map((branch) => this.output[branch.routeIndex].connectionName)
    if (branches.some((branch) => this.lockedRouteIndices.has(branch.routeIndex))) {
      this.outcomes.push({
        outcome: "unsupported", connectionNames,
        reason: "A route already belongs to an accepted pad-junction replacement",
      })
      return null
    }
    const width = this.output[branches[0].routeIndex].traceThickness
    const z = branches[0].points.at(-1)!.z
    const targetShape = targetPad as TargetPad & { shape?: string }
    const unsupported = targetShape.type !== "rect" ||
      (targetShape.shape !== undefined && targetShape.shape !== "rect") ||
      targetPad.ccwRotationDegrees || targetPad.isCopperPour ||
      targetPad.width <= width || targetPad.height <= width ||
      branches.some((branch) => {
        const route = this.output[branch.routeIndex]
        return route.traceThickness !== width || branch.points.at(-1)!.z !== z || Boolean(route.jumpers?.length) ||
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
      const a = first[first.length - 1 - sharedCount]
      const b = second[second.length - 1 - sharedCount]
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
        const start = sharedStem[entryIndex - 1]
        const end = sharedStem[entryIndex]
        let fraction = 0
        for (const axis of ["x", "y"] as const) {
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
    for (const [routeIndex, route] of [...this.output, ...(this.input.otherHdRoutes ?? [])].entries()) {
      const branch = branches.find((candidate) => candidate.routeIndex === routeIndex)
      const sameNet = this.routesAreConnected(this.output[branches[0].routeIndex], route)
      const points = branch ? branch.points.slice(0, branch.anchorIndex + 1) : route.route
      for (let index = 1; index < points.length; index++) {
        if (points[index - 1].z !== z || points[index].z !== z) continue
        fixedCopper.push({
          start: points[index - 1], end: points[index], routeIndex, sameNet,
          width: points[index - 1].traceThickness ?? route.traceThickness,
        })
      }
      for (const via of route.vias) {
        fixedCopper.push({ start: { ...via, z }, end: { ...via, z }, width: route.viaDiameter, routeIndex, sameNet })
      }
    }
    // Moving a terminal run must not remove an existing interior copper tap.
    for (const branch of branches) {
      const points = branch.points.slice(branch.anchorIndex)
      const anchor = points[0]
      for (let index = 1; index < points.length; index++) {
        const start = points[index - 1]
        const end = points[index]
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
            this.isConnected(this.output[branch.routeIndex], identity))
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
      armIndex: 0,
      search: null,
      expanded: 0,
      foundValid: false,
    }
  }

  private segmentIsClear(problem: PadJunctionProblem, start: PadJunctionPoint, end: PadJunctionPoint): boolean {
    for (const obstacle of this.obstacles) {
      if (!obstacle.__zLayers.includes(problem.z) || obstacle === problem.targetPad) continue
      const ownPad = obstacle.connectedTo.some((identity) => this.isConnected(this.output[problem.branches[0].routeIndex], identity))
      if (ownPad && problem.branches.some((branch) => this.insidePad(branch.points[branch.anchorIndex], obstacle))) continue
      if (segmentToBoxMinDistance(start, end, obstacle) < problem.width / 2 + this.clearance - EPSILON) return false
    }
    for (const copper of problem.fixedCopper) {
      // Same-net fixed copper may share a preserved anchor, including a peer route.
      const joinsOwnContinuation = problem.branches.some((branch) => {
        if (!copper.sameNet) return false
        const anchor = branch.points[branch.anchorIndex]
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
    if (!this.input.outline && this.input.bounds) {
      const bounds = this.input.bounds
      const margin = problem.width / 2 + (this.input.minBoardEdgeClearance ?? 0)
      for (const point of [start, end]) {
        if (point.x < bounds.minX + margin - EPSILON ||
          point.x > bounds.maxX - margin + EPSILON ||
          point.y < bounds.minY + margin - EPSILON ||
          point.y > bounds.maxY - margin + EPSILON) return false
      }
    }
    if (this.input.outline) {
      const outline = [...this.input.outline]
      if (!isPointInOrOnPolygon(start, outline) || !isPointInOrOnPolygon(end, outline)) return false
      for (let index = 0; index < outline.length; index++) {
        const distance = minimumDistanceBetweenSegments(
          start, end, outline[index], outline[(index + 1) % outline.length],
        )
        const margin = problem.width / 2 + (this.input.minBoardEdgeClearance ?? 0)
        if (distance < margin - EPSILON) return false
      }
    }
    return true
  }

  private candidateIsValid(problem: PadJunctionProblem, candidate: Candidate): boolean {
    for (const arm of candidate.trunk) {
      for (let index = 1; index < arm.length; index++) {
        if (segmentToBoxMinDistance(arm[index - 1], arm[index], problem.targetPad) <
          problem.width / 2 - EPSILON) return false
      }
    }
    const arms = [...candidate.trunk, candidate.padStem]
    if (arms.some((arm) => arm.length < 2)) return false
    for (const arm of arms) {
      for (let index = 1; index < arm.length; index++) {
        if (!this.segmentIsClear(problem, arm[index - 1], arm[index])) return false
        for (let other = 1; other < index - 1; other++) {
          if (minimumDistanceBetweenSegments(arm[index - 1], arm[index], arm[other - 1], arm[other]) < EPSILON) return false
        }
      }
    }
    // Arms may meet only at the common junction. Check non-adjacent segments as well.
    for (let first = 0; first < arms.length; first++) {
      for (let second = first + 1; second < arms.length; second++) {
        for (let a = 1; a < arms[first].length; a++) {
          for (let b = 1; b < arms[second].length; b++) {
            if (a === 1 && b === 1) {
              const p = arms[first][1]
              const q = arms[second][1]
              const junction = candidate.junction
              const cross = (p.x - junction.x) * (q.y - junction.y) - (p.y - junction.y) * (q.x - junction.x)
              const dot = (p.x - junction.x) * (q.x - junction.x) + (p.y - junction.y) * (q.y - junction.y)
              if (Math.abs(cross) < EPSILON && dot > 0) return false
              continue
            }
            const distance = minimumDistanceBetweenSegments(
              arms[first][a - 1], arms[first][a],
              arms[second][b - 1], arms[second][b],
            )
            if (distance < EPSILON) return false
          }
        }
      }
    }
    return this.insidePad(candidate.padStem.at(-1)!, problem.targetPad, problem.width / 2)
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
    const replacements: HighDensityRoute[] = []
    for (let index = 0; index < 2; index++) {
      const branch = problem.branches[index]
      const route = this.output[branch.routeIndex]
      const terminal = branch.points.at(-1)!
      const padEntry = candidate.padStem.at(-1)!
      if (!this.segmentIsClear(problem, padEntry, terminal)) return false
      const local = simplifyJunctionPath([...candidate.trunk[index]].reverse().concat(candidate.padStem.slice(1)))
      // Retain the terminal identity and exact original endpoint; the tail is pad copper.
      const points = [...branch.points.slice(0, branch.anchorIndex), { ...branch.points[branch.anchorIndex] }, ...local.slice(1)]
      if (Math.hypot(padEntry.x - terminal.x, padEntry.y - terminal.y) > EPSILON) points.push({ ...terminal })
      else points[points.length - 1] = { ...terminal }
      replacements.push({ ...route, route: branch.reversed ? points.reverse() : points })
    }
    for (let index = 0; index < 2; index++) {
      this.output[problem.branches[index].routeIndex] = replacements[index]
      this.lockedRouteIndices.add(problem.branches[index].routeIndex)
    }
    this.acceptedReplacement = candidate
    this.finishProblem("accepted", "Validated improvement; shared pad stem is represented in both point-to-point routes")
    return true
  }

  private initializeSearch(problem: PadJunctionProblem): void {
    const first = problem.branches[0].points[problem.branches[0].anchorIndex]
    const second = problem.branches[1].points[problem.branches[1].anchorIndex]
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
    const step = this.input.gridStep ?? Math.max(problem.width, 0.25)
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
        this.output[branch.routeIndex].connectionName),
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
      this.problem = this.createProblem(this.obstacles[this.obstacleIndex++])
      if (this.problem) this.initializeSearch(this.problem)
      return
    }
    const problem = this.problem
    if (problem.expanded >= (this.input.searchBudget ?? 20000)) {
      this.finishProblem("search_budget_reached", "Expanded-state budget reached without an accepted improvement")
      return
    }
    if (!problem.currentCandidate) {
      const junction = problem.junctions[problem.junctionIndex++]
      if (!junction) {
        this.finishProblem(problem.foundValid ? "no_improvement" : "no_path", "Bounded junction search exhausted")
        return
      }
      problem.currentCandidate = { junction, trunk: [[], []], padStem: [] }
      problem.armIndex = 0
    }
    const candidate = problem.currentCandidate
    if (!problem.search) {
      const first = problem.branches[0].points[problem.branches[0].anchorIndex]
      const second = problem.branches[1].points[problem.branches[1].anchorIndex]
      const horizontalTrunk = (first.x - candidate.junction.x) * (second.x - candidate.junction.x) < 0
      const anchor = problem.armIndex < 2 ? [first, second][problem.armIndex] : null
      // Direction indices follow east, north, west, south in PadJunctionSearch.
      let direction: number
      if (anchor) {
        direction = horizontalTrunk
          ? (anchor.x < candidate.junction.x ? 2 : 0)
          : (anchor.y < candidate.junction.y ? 3 : 1)
      } else {
        direction = horizontalTrunk
          ? (problem.targetPad.center.y < candidate.junction.y ? 3 : 1)
          : (problem.targetPad.center.x < candidate.junction.x ? 2 : 0)
      }
      const completedArms = [...candidate.trunk, candidate.padStem].filter((arm) => arm.length > 0)
      problem.search = new PadJunctionSearch({
        start: candidate.junction, anchor, pad: problem.targetPad, width: problem.width,
        anchors: [first, second], gridStep: this.input.gridStep ?? Math.max(problem.width, 0.25), direction,
        segmentIsClear: (start, end): boolean => {
          if (!this.segmentIsClear(problem, start, end)) return false
          if (problem.armIndex < 2 &&
            segmentToBoxMinDistance(start, end, problem.targetPad) < problem.width / 2 - EPSILON) return false
          for (const arm of completedArms) {
            for (let index = 1; index < arm.length; index++) {
              if (index === 1 && Math.hypot(start.x - candidate.junction.x, start.y - candidate.junction.y) < EPSILON) continue
              if (minimumDistanceBetweenSegments(start, end, arm[index - 1], arm[index]) < EPSILON) return false
            }
          }
          return true
        },
      })
    }
    problem.search.step()
    problem.expanded++
    this.expandedStateCount++
    this.stats = { expandedStates: this.expandedStateCount, junctionsTried: problem.junctionIndex, arm: problem.armIndex }
    if (!problem.search.finished) return
    const path = problem.search.path
    problem.search = null
    if (!path) {
      problem.currentCandidate = null
      return
    }
    if (problem.armIndex < 2) candidate.trunk[problem.armIndex] = path
    else candidate.padStem = path
    problem.armIndex++
    if (problem.armIndex === 3) {
      if (!this.acceptCandidate(problem, candidate)) problem.currentCandidate = null
    }
  }

  override getConstructorParams(): [PadJunctionSimplificationInput] {
    return [this.input]
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("PadJunctionSimplificationSolver: output requested before completion")
    return this.output
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      title: `Pad junction simplification: ${this.expandedStateCount} expanded states`,
      coordinateSystem: "cartesian",
      lines: [], points: [], rects: [],
    }
    for (const obstacle of this.obstacles) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255,0,0,0.15)",
        label: obstacle === this.problem?.targetPad ? "Target pad" : "Obstacle",
      })
    }
    for (const [original, routes] of [[true, this.input.hdRoutes], [false, this.output]] as const) {
      for (const route of routes) {
        for (let index = 1; index < route.route.length; index++) {
          const start = route.route[index - 1]
          const end = route.route[index]
          if (start.z !== end.z) continue
          graphics.lines!.push({
            points: [start, end],
            strokeColor: original
              ? "rgba(128,128,128,0.3)"
              : this.input.colorMap[route.connectionName] ?? "red",
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
      graphics.points!.push({ ...candidate.junction, color: "teal", label: "Junction" })
      for (const arm of [...candidate.trunk, candidate.padStem]) {
        graphics.lines!.push({
          points: arm, strokeColor: "teal", strokeWidth: this.problem?.width ?? 0.1,
        })
      }
    }
    if (this.problem) {
      for (const branch of this.problem.branches) {
        graphics.points!.push({
          ...branch.points[branch.anchorIndex], color: "blue", label: "Branch anchor",
        })
      }
      for (const point of this.problem.search?.expandedPoints ?? []) graphics.points!.push({ ...point, color: "rgba(0,128,128,0.3)" })
      for (const point of this.problem.search?.frontierPoints ?? []) graphics.points!.push({ ...point, color: "orange" })
    }
    return graphics
  }
}
