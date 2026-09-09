import { getOctilinearCandidates } from "./getOctilinearCandidates"
import {
  getPadTerminalEntry,
  entriesMatchPadJunctionPattern,
} from "./getPadTerminalEntry"
import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  pointToSegmentDistance,
  segmentToBoxMinDistance,
} from "@tscircuit/math-utils"
import type { GraphicsObject, Line, Point, Rect, Circle } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import {
  EPSILON,
  getItemOrThrow,
  getPathCost,
  simplifyJunctionPath,
  parsePadJunctionInput,
} from "./padJunctionGeometry"
import type {
  PadJunctionSimplificationInput,
  PadJunctionOutcome,
  AcceptedReplacement,
  ParsedRoute,
  TargetPad,
  PadJunctionProblem,
  Clearance,
  ParsedInput,
  BranchAnchor,
  PadJunctionPoint,
  FixedCopper,
  Candidate,
} from "./padJunctionGeometry"

export type SinglePadJunctionInput = PadJunctionSimplificationInput & {
  targetPadIndex: number
  lockedRouteIndices?: ReadonlyArray<number>
}
export type SinglePadJunctionOutput = {
  outcome: PadJunctionOutcome
  replacements: { routeIndex: number; route: HighDensityRoute }[]
}

export class SinglePadJunctionSolver extends BaseSolver {
  rejectedCandidate: { candidate: Candidate; reason: string } | null = null
  readonly outcomes: PadJunctionOutcome[] = []
  candidatesTried = 0
  private candidates: Candidate[] = []
  acceptedReplacement: AcceptedReplacement | null = null
  private readonly output: ParsedRoute[]
  private readonly obstacles: TargetPad[]
  private initialized = false
  readonly replacements: { routeIndex: number; route: HighDensityRoute }[] = []
  private discoveredBranches: BranchAnchor[] = []
  private readonly targetPad: TargetPad
  private readonly lockedRouteIndices = new Set<number>()
  private problem: PadJunctionProblem | null = null
  private readonly clearance: Clearance

  private readonly parsed: ParsedInput

  constructor(private readonly input: SinglePadJunctionInput) {
    super()
    // Parse once at the boundary. Geometry checks only consume this model.
    this.parsed = parsePadJunctionInput(input)
    this.clearance = this.parsed.minTraceToPadEdgeClearance
    this.obstacles = this.parsed.obstacles
    this.output = [...this.parsed.hdRoutes]
    this.targetPad = getItemOrThrow(this.obstacles, input.targetPadIndex)
    this.lockedRouteIndices = new Set(input.lockedRouteIndices ?? [])
    this.MAX_ITERATIONS = 6 // Setup, at most four proposals, then completion.
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
      if (
        connectedNet !== undefined &&
        this.getNetForIdentity(identity) === connectedNet
      )
        return true
    }
    return false
  }

  private routesAreConnected(
    left: HighDensityRoute,
    right: HighDensityRoute,
  ): boolean {
    const identities = [right.connectionName]
    if (right.rootConnectionName) identities.push(right.rootConnectionName)
    return identities.some((identity) => this.isConnected(left, identity))
  }

  private insidePad(
    point: PadJunctionPoint,
    pad: TargetPad,
    inset = 0,
  ): boolean {
    const halfWidth = pad.width / 2 - inset
    const halfHeight = pad.height / 2 - inset
    return (
      pad.__zLayers.includes(point.z) &&
      halfWidth >= 0 &&
      halfHeight >= 0 &&
      Math.abs(point.x - pad.center.x) <= halfWidth + EPSILON &&
      Math.abs(point.y - pad.center.y) <= halfHeight + EPSILON
    )
  }

  private createProblem(targetPad: TargetPad): PadJunctionProblem | null {
    const discoveredBranches: BranchAnchor[] = []
    for (const [routeIndex, route] of this.output.entries()) {
      if (route.route.length < 2) continue
      if (
        !targetPad.connectedTo.some((identity) =>
          this.isConnected(route, identity),
        )
      )
        continue
      const startInside = this.insidePad(route.firstPoint, targetPad)
      const endInside = this.insidePad(route.lastPoint, targetPad)
      if (startInside === endInside) continue
      const points = startInside ? [...route.route].reverse() : [...route.route]
      const terminal = startInside ? route.firstPoint : route.lastPoint
      let anchorIndex = points.length - 1
      while (
        anchorIndex > 0 &&
        getItemOrThrow(points, anchorIndex - 1).z === terminal.z
      )
        anchorIndex--
      if (anchorIndex === points.length - 1) continue
      discoveredBranches.push({
        routeIndex,
        route,
        points,
        anchor: getItemOrThrow(points, anchorIndex),
        terminal,
        anchorIndex,
        reversed: startInside,
      })
    }
    this.discoveredBranches = discoveredBranches
    const [firstBranch, secondBranch] = discoveredBranches
    // Only two-branch junctions are supported; skip pads with three or more branches.
    if (discoveredBranches.length !== 2 || !firstBranch || !secondBranch) {
      this.outcomes.push({
        outcome: "unsupported",
        connectionNames: discoveredBranches.map(
          (branch) => branch.route.connectionName,
        ),
        reason: `Requires exactly two terminal branches; found ${discoveredBranches.length}`,
      })
      return null
    }
    let branches: [BranchAnchor, BranchAnchor] = [firstBranch, secondBranch]
    const connectionNames = branches.map(
      (branch) => branch.route.connectionName,
    )
    if (
      branches.some((branch) => this.lockedRouteIndices.has(branch.routeIndex))
    ) {
      this.outcomes.push({
        outcome: "unsupported",
        connectionNames,
        reason:
          "A route already belongs to an accepted pad-junction replacement",
      })
      return null
    }
    const width = branches[0].route.traceThickness
    const z = branches[0].terminal.z
    const unsupported =
      targetPad.type !== "rect" ||
      ("shape" in targetPad &&
        targetPad.shape !== undefined &&
        targetPad.shape !== "rect") ||
      targetPad.ccwRotationDegrees ||
      targetPad.isCopperPour ||
      targetPad.width <= width ||
      targetPad.height <= width ||
      branches.some((branch) => {
        const route = branch.route
        return (
          route.traceThickness !== width ||
          branch.terminal.z !== z ||
          Boolean(route.jumpers?.length) ||
          route.route.some(
            (point) =>
              point.toNextSegmentType ||
              point.insideJumperPad ||
              (point.traceThickness !== undefined &&
                point.traceThickness !== width),
          )
        )
      }) ||
      this.obstacles.some(
        (obstacle) =>
          obstacle.__zLayers.includes(z) &&
          Boolean(obstacle.ccwRotationDegrees),
      )
    if (unsupported) {
      this.outcomes.push({
        outcome: "unsupported",
        reason:
          "Requires axis-aligned pads and equal, constant-width terminal runs without jumpers or through-obstacle segments",
        connectionNames,
      })
      return null
    }
    const localMargin = Math.max(targetPad.width, targetPad.height)
    const localBounds = {
      minX: targetPad.center.x - targetPad.width / 2 - localMargin,
      maxX: targetPad.center.x + targetPad.width / 2 + localMargin,
      minY: targetPad.center.y - targetPad.height / 2 - localMargin,
      maxY: targetPad.center.y + targetPad.height / 2 + localMargin,
    }
    const firstEntry = getPadTerminalEntry(firstBranch, targetPad, localBounds)
    const secondEntry = getPadTerminalEntry(
      secondBranch,
      targetPad,
      localBounds,
    )
    if (
      !firstEntry ||
      !secondEntry ||
      !entriesMatchPadJunctionPattern(firstEntry, secondEntry)
    ) {
      this.outcomes.push({
        outcome: "unsupported",
        connectionNames,
        reason: "Requires an acute same-edge V meeting inside the pad",
      })
      return null
    }
    branches = [firstEntry.branch, secondEntry.branch]
    this.discoveredBranches = branches
    const first = simplifyJunctionPath(
      branches[0].points.slice(branches[0].anchorIndex),
    )
    const second = simplifyJunctionPath(
      branches[1].points.slice(branches[1].anchorIndex),
    )
    const originalCost = getPathCost(
      simplifyJunctionPath([...first, ...second.slice(0, -1).reverse()]),
    )
    const fixedCopper: FixedCopper[] = []
    for (const [routeIndex, route] of [
      ...this.output,
      ...this.parsed.otherHdRoutes,
    ].entries()) {
      const branch = branches.find(
        (candidate) => candidate.routeIndex === routeIndex,
      )
      const sameNet = this.routesAreConnected(branches[0].route, route)
      const points = branch
        ? branch.points.slice(0, branch.anchorIndex + 1)
        : route.route
      for (let index = 1; index < points.length; index++) {
        if (
          getItemOrThrow(points, index - 1).z !== z ||
          getItemOrThrow(points, index).z !== z
        )
          continue
        fixedCopper.push({
          start: getItemOrThrow(points, index - 1),
          end: getItemOrThrow(points, index),
          routeIndex,
          sameNet,
          width:
            getItemOrThrow(points, index - 1).traceThickness ??
            route.traceThickness,
        })
      }
      for (const via of route.vias) {
        fixedCopper.push({
          start: { ...via, z },
          end: { ...via, z },
          width: route.viaDiameter,
          routeIndex,
          sameNet,
        })
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
          const distance = minimumDistanceBetweenSegments(
            start,
            end,
            copper.start,
            copper.end,
          )
          if (distance > (width + copper.width) / 2 + EPSILON) continue
          if (
            this.insidePad(start, targetPad) &&
            this.insidePad(end, targetPad)
          )
            continue
          const copperTouchesAnchor = [copper.start, copper.end].some(
            (point) =>
              Math.hypot(point.x - anchor.x, point.y - anchor.y) < EPSILON,
          )
          const hasOtherTap = [copper.start, copper.end].some(
            (point) =>
              !this.insidePad(point, targetPad) &&
              Math.hypot(point.x - anchor.x, point.y - anchor.y) > EPSILON &&
              pointToSegmentDistance(point, start, end) <
                (width + copper.width) / 2,
          )
          if (copperTouchesAnchor && !hasOtherTap) continue
          this.outcomes.push({
            outcome: "unsupported",
            connectionNames,
            reason:
              "A replaceable terminal run has a fixed-copper interior tap",
          })
          return null
        }
        for (const obstacle of this.obstacles) {
          if (
            obstacle === targetPad ||
            !obstacle.__zLayers.includes(z) ||
            this.insidePad(anchor, obstacle)
          )
            continue
          const sameNet = obstacle.connectedTo.some((identity) =>
            this.isConnected(branch.route, identity),
          )
          if (
            !sameNet ||
            segmentToBoxMinDistance(start, end, obstacle) > width / 2
          )
            continue
          this.outcomes.push({
            outcome: "unsupported",
            connectionNames,
            reason: "A replaceable terminal run touches another connected pad",
          })
          return null
        }
      }
    }
    return {
      localBounds,
      targetPad,
      branches: [branches[0], branches[1]],
      width,
      z,
      originalCost,
      fixedCopper,
      foundValid: false,
    }
  }

  private segmentIsClear(
    problem: PadJunctionProblem,
    start: PadJunctionPoint,
    end: PadJunctionPoint,
  ): boolean {
    for (const point of [start, end]) {
      if (
        point.x < problem.localBounds.minX - EPSILON ||
        point.x > problem.localBounds.maxX + EPSILON ||
        point.y < problem.localBounds.minY - EPSILON ||
        point.y > problem.localBounds.maxY + EPSILON
      )
        return false
    }
    for (const obstacle of this.obstacles) {
      if (
        !obstacle.__zLayers.includes(problem.z) ||
        obstacle === problem.targetPad
      )
        continue
      const ownPad = obstacle.connectedTo.some((identity) =>
        this.isConnected(problem.branches[0].route, identity),
      )
      if (
        ownPad &&
        problem.branches.some((branch) =>
          this.insidePad(branch.anchor, obstacle),
        )
      )
        continue
      if (
        segmentToBoxMinDistance(start, end, obstacle) <
        problem.width / 2 + this.clearance - EPSILON
      )
        return false
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
          Math.hypot(anchor.x - copper.start.x, anchor.y - copper.start.y) <
            EPSILON ||
          Math.hypot(anchor.x - copper.end.x, anchor.y - copper.end.y) < EPSILON
        return replacementTouches && continuationTouches
      })
      if (joinsOwnContinuation) continue
      const distance = minimumDistanceBetweenSegments(
        start,
        end,
        copper.start,
        copper.end,
      )
      if (
        distance <
        (problem.width + copper.width) / 2 + this.clearance - EPSILON
      )
        return false
    }
    // An explicit outline is authoritative; SRJ bounds describe rectangular boards.
    if (!this.parsed.outline && this.parsed.bounds) {
      const bounds = this.parsed.bounds
      const margin = problem.width / 2 + this.parsed.minBoardEdgeClearance
      for (const point of [start, end]) {
        if (
          point.x < bounds.minX + margin - EPSILON ||
          point.x > bounds.maxX - margin + EPSILON ||
          point.y < bounds.minY + margin - EPSILON ||
          point.y > bounds.maxY - margin + EPSILON
        )
          return false
      }
    }
    if (this.parsed.outline) {
      const outline = [...this.parsed.outline]
      if (
        !isPointInOrOnPolygon(start, outline) ||
        !isPointInOrOnPolygon(end, outline)
      )
        return false
      for (let index = 0; index < outline.length; index++) {
        const distance = minimumDistanceBetweenSegments(
          start,
          end,
          getItemOrThrow(outline, index),
          getItemOrThrow(outline, (index + 1) % outline.length),
        )
        const margin = problem.width / 2 + this.parsed.minBoardEdgeClearance
        if (distance < margin - EPSILON) return false
      }
    }
    return true
  }

  private rejectCandidate(candidate: Candidate, reason: string): false {
    this.rejectedCandidate = { candidate, reason }
    this.stats = {
      ...this.stats,
      rejectedCandidateReason: reason,
    }
    return false
  }

  private candidateIsValid(
    problem: PadJunctionProblem,
    candidate: Candidate,
  ): boolean {
    for (const arm of [...candidate.trunk, candidate.padStem]) {
      for (let index = 1; index < arm.length; index++) {
        const start = getItemOrThrow(arm, index - 1)
        const end = getItemOrThrow(arm, index)
        const dx = end.x - start.x
        const dy = end.y - start.y
        if (
          Math.abs(dx) > EPSILON &&
          Math.abs(dy) > EPSILON &&
          Math.abs(Math.abs(dx) - Math.abs(dy)) > EPSILON
        )
          return this.rejectCandidate(
            candidate,
            "Requires cardinal or 45-degree segments",
          )
        if (index > 1) {
          const previous = getItemOrThrow(arm, index - 2)
          if (
            (start.x - previous.x) * dx + (start.y - previous.y) * dy <
            -EPSILON
          )
            return this.rejectCandidate(
              candidate,
              "Replacement creates an acute bend",
            )
        }
      }
    }
    for (const [index, branch] of problem.branches.entries()) {
      if (branch.anchorIndex === 0) continue
      const previous = getItemOrThrow(branch.points, branch.anchorIndex - 1)
      const arm = getItemOrThrow(candidate.trunk, index)
      const next = getItemOrThrow(arm, arm.length - 2)
      if (
        (branch.anchor.x - previous.x) * (next.x - branch.anchor.x) +
          (branch.anchor.y - previous.y) * (next.y - branch.anchor.y) <
        -EPSILON
      )
        return this.rejectCandidate(
          candidate,
          "Replacement creates an acute bend at the anchor",
        )
    }
    for (const arm of candidate.trunk) {
      for (let index = 1; index < arm.length; index++) {
        if (
          segmentToBoxMinDistance(
            getItemOrThrow(arm, index - 1),
            getItemOrThrow(arm, index),
            problem.targetPad,
          ) <
          problem.width / 2 - EPSILON
        )
          return this.rejectCandidate(candidate, "Trunk enters target pad")
      }
    }
    const arms = [...candidate.trunk, candidate.padStem]
    if (arms.some((arm) => arm.length < 2))
      return this.rejectCandidate(candidate, "An arm has no segment")
    for (const arm of arms) {
      for (let index = 1; index < arm.length; index++) {
        if (
          !this.segmentIsClear(
            problem,
            getItemOrThrow(arm, index - 1),
            getItemOrThrow(arm, index),
          )
        )
          return this.rejectCandidate(
            candidate,
            "Arm violates copper or board clearance",
          )
        for (let other = 1; other < index - 1; other++) {
          if (
            minimumDistanceBetweenSegments(
              getItemOrThrow(arm, index - 1),
              getItemOrThrow(arm, index),
              getItemOrThrow(arm, other - 1),
              getItemOrThrow(arm, other),
            ) < EPSILON
          )
            return this.rejectCandidate(
              candidate,
              "Arms intersect away from the junction",
            )
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
              const dot =
                (p.x - junction.x) * (q.x - junction.x) +
                (p.y - junction.y) * (q.y - junction.y)
              if (dot > EPSILON)
                return this.rejectCandidate(
                  candidate,
                  "Arms form an acute angle at the junction",
                )
              continue
            }
            const distance = minimumDistanceBetweenSegments(
              getItemOrThrow(firstArm, a - 1),
              getItemOrThrow(firstArm, a),
              getItemOrThrow(secondArm, b - 1),
              getItemOrThrow(secondArm, b),
            )
            if (distance < EPSILON)
              return this.rejectCandidate(
                candidate,
                "Arms intersect away from the junction",
              )
          }
        }
      }
    }
    if (
      !this.insidePad(
        getItemOrThrow(candidate.padStem, candidate.padStem.length - 1),
        problem.targetPad,
        problem.width / 2,
      )
    ) {
      return this.rejectCandidate(
        candidate,
        "Stem does not reach inset pad copper",
      )
    }
    return true
  }

  private acceptCandidate(
    problem: PadJunctionProblem,
    candidate: Candidate,
  ): boolean {
    if (!this.candidateIsValid(problem, candidate)) return false
    problem.foundValid = true
    const trunk = [...candidate.trunk[0]]
      .reverse()
      .concat(candidate.trunk[1].slice(1))
    const trunkCost = getPathCost(simplifyJunctionPath(trunk))
    const stemCost = getPathCost(candidate.padStem)
    const cost = {
      bends: trunkCost.bends + stemCost.bends,
      length: trunkCost.length + stemCost.length,
    }
    const improvesCost =
      cost.bends < problem.originalCost.bends ||
      (cost.bends === problem.originalCost.bends &&
        cost.length < problem.originalCost.length - EPSILON)
    if (!improvesCost)
      return this.rejectCandidate(
        candidate,
        "Candidate does not improve bend count and length",
      )
    const replacements: ParsedRoute[] = []
    for (const [index, branch] of problem.branches.entries()) {
      const route = branch.route
      const terminal = branch.terminal
      const padEntry = getItemOrThrow(
        candidate.padStem,
        candidate.padStem.length - 1,
      )
      if (!this.segmentIsClear(problem, padEntry, terminal))
        return this.rejectCandidate(
          candidate,
          "Endpoint tail violates clearance",
        )
      const local = simplifyJunctionPath(
        [...getItemOrThrow(candidate.trunk, index)]
          .reverse()
          .concat(candidate.padStem.slice(1)),
      )
      // Retain the terminal identity and exact original endpoint; the tail is pad copper.
      const points = [
        ...branch.points.slice(0, branch.anchorIndex),
        { ...branch.anchor },
        ...local.slice(1),
      ]
      if (
        Math.hypot(padEntry.x - terminal.x, padEntry.y - terminal.y) > EPSILON
      )
        points.push({ ...terminal })
      else points[points.length - 1] = { ...terminal }
      const orderedPoints = branch.reversed ? points.reverse() : points
      const firstPoint = getItemOrThrow(orderedPoints, 0)
      const lastPoint = getItemOrThrow(orderedPoints, orderedPoints.length - 1)
      replacements.push({
        ...route,
        route: orderedPoints,
        firstPoint,
        lastPoint,
      })
    }
    for (const [index, branch] of problem.branches.entries()) {
      this.output[branch.routeIndex] = getItemOrThrow(replacements, index)
      const { firstPoint, lastPoint, ...route } = getItemOrThrow(
        replacements,
        index,
      )
      this.replacements.push({ routeIndex: branch.routeIndex, route })
    }
    this.acceptedReplacement = candidate
    this.finishProblem(
      "accepted",
      "Validated improvement; shared pad stem is represented in both point-to-point routes",
    )
    return true
  }

  private finishProblem(
    outcome: PadJunctionOutcome["outcome"],
    reason: string,
  ): void {
    if (!this.problem)
      throw new Error("SinglePadJunctionSolver: missing active problem")
    this.outcomes.push({
      outcome,
      reason,
      connectionNames: this.problem.branches.map(
        (branch) => branch.route.connectionName,
      ),
    })
    this.stats = {
      candidatesTried: this.candidatesTried,
      outcome,
      reason,
      rejectedCandidateReason: this.rejectedCandidate?.reason,
    }
    this.solved = true
  }

  override _step(): void {
    if (!this.initialized) {
      this.initialized = true
      this.problem = this.createProblem(this.targetPad)
      if (this.problem) this.candidates = getOctilinearCandidates(this.problem)
      else {
        this.solved = true
        this.stats = {
          outcome: this.outcomes[0]?.outcome,
          reason: this.outcomes[0]?.reason,
        }
      }
      return
    }
    if (!this.problem)
      throw new Error("SinglePadJunctionSolver: missing active problem")
    const candidate = this.candidates[this.candidatesTried]
    if (!candidate) {
      this.finishProblem(
        this.problem.foundValid ? "no_improvement" : "no_path",
        "Direct V candidates exhausted",
      )
      return
    }
    this.candidatesTried++
    this.acceptCandidate(this.problem, candidate)
  }

  override getConstructorParams(): [SinglePadJunctionInput] {
    return [this.input]
  }

  override getOutput(): SinglePadJunctionOutput {
    if (!this.solved)
      throw new Error(
        "SinglePadJunctionSolver: output requested before completion",
      )
    return {
      outcome: getItemOrThrow(this.outcomes, 0),
      replacements: this.replacements,
    }
  }

  override visualize(): GraphicsObject {
    const lines: Line[] = []
    const points: Point[] = []
    const rects: Rect[] = []
    const circles: Circle[] = []
    const graphics: GraphicsObject = {
      title: `Pad ${this.targetPad.obstacleId ?? this.input.targetPadIndex}: ${this.outcomes[0]?.reason ?? "Checking V candidates"} (${this.candidatesTried} candidates tried)`,
      coordinateSystem: "cartesian",
      lines,
      points,
      rects,
      circles,
    }
    for (const obstacle of this.obstacles) {
      rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill:
          obstacle === this.targetPad
            ? "rgba(0,128,128,0.2)"
            : "rgba(255,0,0,0.15)",
        layer: getGraphicsLayerForObstacle(obstacle, this.parsed.layerCount),
        label: obstacle === this.targetPad ? "Target pad" : "Obstacle",
      })
    }
    const routeLayers: { original: boolean; routes: ParsedRoute[] }[] = [
      { original: true, routes: this.parsed.hdRoutes },
      { original: false, routes: this.output },
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
              : (this.parsed.colorMap[route.connectionName] ?? "red"),
            strokeWidth: route.traceThickness,
            strokeDash: original || start.z !== 0 ? [0.08, 0.08] : undefined,
            layer: `z${start.z}`,
            label: original ? "Original connection" : route.connectionName,
          })
        }
      }
    }
    for (const route of this.parsed.otherHdRoutes) {
      for (let index = 1; index < route.route.length; index++) {
        const start = getItemOrThrow(route.route, index - 1)
        const end = getItemOrThrow(route.route, index)
        if (start.z !== end.z) continue
        lines.push({
          points: [start, end],
          strokeColor: "#555555",
          strokeWidth: start.traceThickness ?? route.traceThickness,
          strokeDash: start.z === 0 ? undefined : [0.08, 0.08],
          layer: `z${start.z}`,
          label: `Fixed: ${route.connectionName}`,
        })
      }
    }
    for (const copper of this.problem?.fixedCopper ?? []) {
      if (copper.start.x === copper.end.x && copper.start.y === copper.end.y) {
        circles.push({
          center: copper.start,
          radius: copper.width / 2,
          fill: "rgba(0,0,255,0.4)",
          layer: `z${copper.start.z}`,
          label: "Fixed via",
        })
      } else {
        lines.push({
          points: [copper.start, copper.end],
          strokeWidth: copper.width,
          strokeColor: "#555555",
          layer: `z${copper.start.z}`,
          label: "Fixed copper",
        })
      }
    }
    if (this.parsed.outline) {
      lines.push({
        points: [
          ...this.parsed.outline,
          getItemOrThrow(this.parsed.outline, 0),
        ],
        strokeColor: "black",
        label: "Board outline",
      })
    } else if (this.parsed.bounds) {
      const { minX, minY, maxX, maxY } = this.parsed.bounds
      lines.push({
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
          { x: minX, y: minY },
        ],
        strokeColor: "black",
        label: "Board bounds",
      })
    }
    const candidate =
      this.acceptedReplacement ?? this.rejectedCandidate?.candidate
    if (candidate) {
      const rejected = candidate === this.rejectedCandidate?.candidate
      const candidateColor = rejected ? "orange" : "teal"
      points.push({
        ...candidate.junction,
        color: candidateColor,
        label: rejected ? this.rejectedCandidate?.reason : "Junction",
        layer: `z${candidate.junction.z}`,
      })
      const arms = [...candidate.trunk, candidate.padStem]
      for (const [index, arm] of arms.entries()) {
        lines.push({
          points: arm,
          strokeColor: candidateColor,
          strokeDash: rejected ? [0.08, 0.08] : undefined,
          strokeWidth: this.problem?.width ?? 0.1,
          layer: `z${candidate.junction.z}`,
          label: index < 2 ? `Trunk arm ${index + 1}` : "Pad stem",
        })
      }
      if ("padStem" in candidate) {
        points.push({
          ...getItemOrThrow(candidate.padStem, candidate.padStem.length - 1),
          color: "green",
          label: "Pad entry",
          layer: `z${candidate.junction.z}`,
        })
      }
    }
    for (const branch of this.discoveredBranches) {
      points.push({
        ...branch.anchor,
        color: "blue",
        label: `Anchor: ${branch.route.connectionName}`,
        layer: `z${branch.anchor.z}`,
      })
    }
    return graphics
  }
}
