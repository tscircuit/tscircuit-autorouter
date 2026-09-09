/**
 * Terminology dictionary
 * Point: a route coordinate and its layer.
 * Terminal position: a terminal's route index and point index.
 * Pad: a rectangular conductive obstacle. Route: one routed connection.
 * Net: the canonical connectivity identity shared by connected routes and pads.
 * Terminal: a preserved route endpoint inside a pad.
 * Run: the final straight part of a route approaching its terminal.
 * Run direction: traversal from the terminal toward the route start or end.
 * Cut: where a run meets the new head; all earlier copper is preserved.
 * Head: the straight connection between the two cuts of a V.
 * Gap: half a trace width of empty space between the head edge and pad edge.
 * Junction: the point on the head directly outside the terminal.
 * Stem: the shared perpendicular connection from junction to terminal.
 *
 * Before                         After
 *   preserved route   route        preserved route   route
 *          \         /                    \         /
 *           \ Run   / Run              Cut o----+----o Cut  <-- Head
 *            \     /                           |
 *          +--\---/--+                 Gap      | Stem
 *          |   \ /   |                     +---|---+
 *          |    o    | Pad                 |   o   | Pad
 *          +---------+                     +-------+
 *            Terminal                       Terminal
 *
 * The + in the Head marks the Junction. The Gap is measured
 * from the copper edge of the Head to the Pad edge, beside the Stem.
 *
 * A V has two converging runs on opposite sides of a cardinal stem axis.
 * Intersect both runs with the nearest head outside the pad, then add the stem.
 * There is one construction, no routing search. Unsupported or blocked Vs stay
 * unchanged. One step visits one pad; route terminals are indexed once by net.
 */
import { BaseSolver } from "@tscircuit/solver-utils"
import {
  pointToSegmentDistance,
  segmentToBoxMinDistance,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityRoute,
  HighDensityRoutePoint,
} from "lib/types/high-density-types"
import { isPointInRect } from "lib/utils/isPointInRect"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

import {
  parsePadJunctionInput,
  type Pad,
  type PadJunctionSimplificationInput,
  type TerminalPosition,
} from "./parsePadJunctionInput"
import { visualizePadJunctionSimplification } from "./visualizePadJunctionSimplification"

export type { PadJunctionSimplificationInput } from "./parsePadJunctionInput"

type Point = HighDensityRoutePoint
enum RunDirection {
  TowardRouteStart = -1,
  TowardRouteEnd = 1,
}
type Run = TerminalPosition & {
  terminal: Point
  start: Point
  startIndex: number
  direction: RunDirection
}
type CutRun = Run & { cut: Point; preserved: Point[] }
export type AcceptedReplacement = {
  junction: Point
  head: [Point, Point]
  stem: [Point, Point]
}
export type PadJunctionOutcome = {
  outcome: "accepted" | "unsupported" | "no_path" | "no_improvement"
  reason: string
  connectionNames: string[]
}
const EPSILON = 1e-7
const TERMINAL_TOLERANCE = 0.001

export class PadJunctionSimplificationSolver extends BaseSolver {
  readonly outcomes: PadJunctionOutcome[] = []
  acceptedReplacement: AcceptedReplacement | null = null
  private readonly output: HighDensityRoute[]
  private readonly pads: Pad[]
  private readonly terminalsByNet: Map<string, TerminalPosition[]>
  private readonly nets = new Map<string, string>()
  private readonly lockedRoutes = new Set<number>()
  private readonly clearance: number
  private readonly boardClearance: number
  private padIndex = 0

  constructor(private readonly input: PadJunctionSimplificationInput) {
    super()
    const parsed = parsePadJunctionInput(input, (identity): string =>
      this.getNet(identity),
    )
    this.clearance = parsed.clearance
    this.boardClearance = parsed.boardClearance
    this.output = parsed.output
    this.pads = parsed.pads
    this.terminalsByNet = parsed.terminalsByNet
    this.MAX_ITERATIONS = this.pads.length + 1
  }

  private getNet(identity: string): string {
    const cached = this.nets.get(identity)
    if (cached !== undefined) return cached
    const map = this.input.connMap
    let net = map.getNetConnectedToId(identity)
    if (net === undefined) {
      const member = map.getIdsConnectedToNet(identity)[0]
      net = member === undefined ? identity : map.getNetConnectedToId(member)
    }
    if (net === undefined)
      throw new Error(
        `PadJunctionSimplificationSolver: net missing for "${identity}"`,
      )
    this.nets.set(identity, net)
    return net
  }

  private getRun(terminalPosition: TerminalPosition, pad: Pad): Run | null {
    const route = this.output[terminalPosition.routeIndex]!
    const points = route.route
    const terminal = points[terminalPosition.index]!
    const direction =
      terminalPosition.index === 0
        ? RunDirection.TowardRouteEnd
        : RunDirection.TowardRouteStart
    let startIndex = terminalPosition.index + direction
    while (
      startIndex >= 0 &&
      startIndex < points.length &&
      points[startIndex]!.z === terminal.z &&
      Math.hypot(
        points[startIndex]!.x - terminal.x,
        points[startIndex]!.y - terminal.y,
      ) < EPSILON
    )
      startIndex += direction
    if (startIndex < 0 || startIndex >= points.length) return null
    const first = points[startIndex]!
    const dx = first.x - terminal.x
    const dy = first.y - terminal.y
    while (
      startIndex + direction >= 0 &&
      startIndex + direction < points.length
    ) {
      const next = points[startIndex + direction]!
      const previous = points[startIndex]!
      if (
        next.z !== terminal.z ||
        Math.abs(dx * (next.y - terminal.y) - dy * (next.x - terminal.x)) >
          EPSILON ||
        dx * (next.x - previous.x) + dy * (next.y - previous.y) <= EPSILON
      )
        break
      startIndex += direction
    }
    const start = points[startIndex]!
    if (
      start.z !== terminal.z ||
      isPointInRect(start, pad) ||
      route.jumpers?.length
    )
      return null
    for (
      let index = terminalPosition.index;
      index !== startIndex + direction;
      index += direction
    ) {
      const point = points[index]!
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error(
          `PadJunctionSimplificationSolver: invalid run "${route.connectionName}"`,
        )
      if (
        point.insideJumperPad ||
        point.toNextSegmentType ||
        point.toNextSegmentCircuitJsonMetadata ||
        (index !== terminalPosition.index &&
          index !== startIndex &&
          point.pcb_port_id) ||
        (point.traceThickness !== undefined &&
          point.traceThickness !== route.traceThickness)
      )
        return null
    }
    return { ...terminalPosition, terminal, start, startIndex, direction }
  }

  private simplifyPad(
    pad: Pad,
    terminalPositions: [TerminalPosition, TerminalPosition],
  ): PadJunctionOutcome {
    const connectionNames = terminalPositions.map(
      ({ routeIndex }) => this.output[routeIndex]!.connectionName,
    )
    const unsupported: PadJunctionOutcome = {
      outcome: "unsupported",
      reason: "Requires two straight runs forming a V around a cardinal stem",
      connectionNames,
    }
    if (
      terminalPositions.some(({ routeIndex }) =>
        this.lockedRoutes.has(routeIndex),
      )
    )
      return unsupported
    const first = this.getRun(terminalPositions[0], pad)
    const second = this.getRun(terminalPositions[1], pad)
    if (!first || !second) return unsupported
    const width = this.output[first.routeIndex]!.traceThickness
    if (
      this.output[second.routeIndex]!.traceThickness !== width ||
      first.terminal.z !== second.terminal.z ||
      pad.width <= width ||
      pad.height <= width ||
      Math.hypot(
        first.terminal.x - second.terminal.x,
        first.terminal.y - second.terminal.y,
      ) > TERMINAL_TOLERANCE
    )
      return unsupported
    const ax = first.start.x - first.terminal.x
    const ay = first.start.y - first.terminal.y
    const bx = second.start.x - second.terminal.x
    const by = second.start.y - second.terminal.y
    if (ax * bx + ay * by < -EPSILON) return unsupported
    const axis =
      ay * by > EPSILON && ax * bx < -EPSILON
        ? "y"
        : ax * bx > EPSILON && ay * by < -EPSILON
          ? "x"
          : null
    if (!axis) return unsupported
    const across = axis === "x" ? "y" : "x"
    const sign = Math.sign(first.start[axis] - first.terminal[axis])
    const terminal = first.terminal
    const runs: [Run, Run] = [first, second]
    const gap = width / 2
    let height =
      sign * pad.center[axis] +
      (axis === "x" ? pad.width : pad.height) / 2 +
      width / 2 +
      gap
    for (const run of runs) {
      const slope =
        (run.start[across] - run.terminal[across]) /
        (sign * (run.start[axis] - run.terminal[axis]))
      height = Math.max(
        height,
        sign * run.terminal[axis] +
          (width -
            Math.sign(slope) * (run.terminal[across] - terminal[across])) /
            Math.abs(slope),
      )
    }
    const junction: Point = {
      x: terminal.x,
      y: terminal.y,
      z: terminal.z,
      [axis]: sign * height,
    }
    const cuts: CutRun[] = []
    for (const run of runs) {
      const fraction =
        (sign * height - run.terminal[axis]) /
        (run.start[axis] - run.terminal[axis])
      if (fraction <= 0 || fraction > 1 + EPSILON)
        return {
          outcome: "no_path",
          reason: "Insufficient straight-run room for the head gap",
          connectionNames,
        }
      const cut: Point = {
        x: run.terminal.x + fraction * (run.start.x - run.terminal.x),
        y: run.terminal.y + fraction * (run.start.y - run.terminal.y),
        z: terminal.z,
      }
      const points = this.output[run.routeIndex]!.route
      let cutIndex = run.startIndex
      while (
        cutIndex - run.direction !== run.index &&
        sign * points[cutIndex - run.direction]![axis] >= height - EPSILON
      )
        cutIndex -= run.direction
      const preserved =
        run.direction === RunDirection.TowardRouteStart
          ? points.slice(0, cutIndex + 1)
          : points.slice(cutIndex).reverse()
      if (
        Math.hypot(preserved.at(-1)!.x - cut.x, preserved.at(-1)!.y - cut.y) >
        EPSILON
      )
        preserved.push(cut)
      cuts.push({ ...run, cut, preserved })
    }
    const [left, right] = cuts as [CutRun, CutRun]
    const leftLength = Math.abs(left.cut[across] - junction[across])
    const rightLength = Math.abs(right.cut[across] - junction[across])
    if (
      Math.min(leftLength, rightLength) <
      (leftLength + rightLength) / 4 - EPSILON
    )
      return unsupported
    const oldLength =
      Math.hypot(left.cut.x - left.terminal.x, left.cut.y - left.terminal.y) +
      Math.hypot(right.cut.x - right.terminal.x, right.cut.y - right.terminal.y)
    const newLength =
      leftLength + rightLength + Math.abs(junction[axis] - terminal[axis])
    if (newLength > oldLength * 1.1 + EPSILON)
      return {
        outcome: "no_improvement",
        reason: "Head and stem exceed 10% copper growth",
        connectionNames,
      }
    const replacement: AcceptedReplacement = {
      junction,
      head: [left.cut, right.cut],
      stem: [junction, terminal],
    }
    const blocked = this.checkClearance(pad, [left, right], replacement, width)
    if (blocked) return { outcome: "no_path", reason: blocked, connectionNames }
    for (const run of cuts) {
      const points = [...run.preserved, junction, run.terminal]
      if (run.direction === RunDirection.TowardRouteEnd) points.reverse()
      this.output[run.routeIndex] = {
        ...this.output[run.routeIndex]!,
        route: points,
      }
      this.lockedRoutes.add(run.routeIndex)
    }
    this.acceptedReplacement = replacement
    return {
      outcome: "accepted",
      reason: "Replaced V with a straight head and perpendicular stem",
      connectionNames,
    }
  }

  private checkClearance(
    pad: Pad,
    runs: [CutRun, CutRun],
    replacement: AcceptedReplacement,
    width: number,
  ): string | null {
    const { junction } = replacement
    const segments: [Point, Point][] = [
      [runs[0].cut, runs[1].cut],
      [junction, runs[0].terminal],
      [junction, runs[1].terminal],
    ]
    const z = junction.z
    const firstRoute = this.output[runs[0].routeIndex]!
    const nets = new Set([this.getNet(firstRoute.connectionName)])
    if (firstRoute.rootConnectionName)
      nets.add(this.getNet(firstRoute.rootConnectionName))
    for (const obstacle of this.pads) {
      if (obstacle === pad || !obstacle.__zLayers.includes(z)) continue
      if (obstacle.ccwRotationDegrees)
        return "Rotated obstacles are unsupported"
      const sameNet = obstacle.connectedTo.some((identity) =>
        nets.has(this.getNet(identity)),
      )
      if (
        sameNet &&
        runs.some(
          (run) =>
            segmentToBoxMinDistance(run.cut, run.cut, obstacle) <=
            width / 2 + EPSILON,
        )
      )
        continue
      if (
        sameNet &&
        runs.some(
          (run) =>
            segmentToBoxMinDistance(run.cut, run.terminal, obstacle) <
            width / 2 - EPSILON,
        )
      )
        return "A removed run touches another connected pad"
      if (
        segments.some(
          ([start, end]) =>
            segmentToBoxMinDistance(start, end, obstacle) <
            width / 2 + this.clearance - EPSILON,
        )
      )
        return "Head or stem violates pad clearance"
    }
    const allRoutes = [...this.output, ...(this.input.otherHdRoutes ?? [])]
    for (const [routeIndex, route] of allRoutes.entries()) {
      const sameNet =
        nets.has(this.getNet(route.connectionName)) ||
        (route.rootConnectionName !== undefined &&
          nets.has(this.getNet(route.rootConnectionName)))
      const run = runs.find((candidate) => candidate.routeIndex === routeIndex)
      const points = run ? run.preserved : route.route
      for (let index = 1; index < points.length; index++) {
        const start = points[index - 1]!
        const end = points[index]!
        if (start.z !== z || end.z !== z) continue
        const copperWidth = start.traceThickness ?? route.traceThickness
        if (!sameNet) {
          if (
            segments.some(
              ([a, b]) =>
                minimumDistanceBetweenSegments(a, b, start, end) <
                (width + copperWidth) / 2 + this.clearance - EPSILON,
            )
          )
            return "Head or stem violates trace clearance"
          continue
        }
        if (isPointInRect(start, pad) && isPointInRect(end, pad)) continue
        for (const removed of runs) {
          // Copper touching the preserved cut remains connected after replacement.
          if (
            pointToSegmentDistance(removed.cut, start, end) <=
            (width + copperWidth) / 2 + EPSILON
          )
            continue
          if (
            minimumDistanceBetweenSegments(
              removed.cut,
              removed.terminal,
              start,
              end,
            ) <
            (width + copperWidth) / 2 - EPSILON
          )
            return "A removed run has an existing copper tap"
        }
      }
      for (const via of route.vias) {
        if (
          !sameNet &&
          segments.some(
            ([start, end]) =>
              pointToSegmentDistance(via, start, end) <
              (width + route.viaDiameter) / 2 + this.clearance - EPSILON,
          )
        )
          return "Head or stem violates via clearance"
        if (
          sameNet &&
          !isPointInRect(via, pad) &&
          runs.some(
            (removed) =>
              Math.hypot(via.x - removed.cut.x, via.y - removed.cut.y) >
                (width + route.viaDiameter) / 2 + EPSILON &&
              pointToSegmentDistance(via, removed.cut, removed.terminal) <
                (width + route.viaDiameter) / 2 - EPSILON,
          )
        )
          return "A removed run has an existing via tap"
      }
    }
    const margin = width / 2 + this.boardClearance
    const outline = this.input.outline ? [...this.input.outline] : undefined
    for (const [start, end] of segments) {
      if (outline) {
        if (
          !isPointInOrOnPolygon(start, outline) ||
          !isPointInOrOnPolygon(end, outline)
        )
          return "Head or stem leaves the board"
        for (let index = 0; index < outline.length; index++)
          if (
            minimumDistanceBetweenSegments(
              start,
              end,
              outline[index]!,
              outline[(index + 1) % outline.length]!,
            ) <
            margin - EPSILON
          )
            return "Head or stem violates board clearance"
      } else if (this.input.bounds) {
        const { minX, minY, maxX, maxY } = this.input.bounds
        if (
          [start, end].some(
            (point) =>
              point.x < minX + margin - EPSILON ||
              point.x > maxX - margin + EPSILON ||
              point.y < minY + margin - EPSILON ||
              point.y > maxY - margin + EPSILON,
          )
        )
          return "Head or stem violates board clearance"
      }
    }
    return null
  }

  override _step(): void {
    const pad = this.pads[this.padIndex++]
    if (!pad) {
      this.solved = true
      return
    }
    if (
      pad.type !== "rect" ||
      pad.ccwRotationDegrees ||
      pad.isCopperPour ||
      ("shape" in pad && pad.shape !== undefined && pad.shape !== "rect")
    ) {
      if (this.padIndex === this.pads.length) this.solved = true
      return
    }
    const found = new Map<number, TerminalPosition>()
    const visitedNets = new Set<string>()
    for (const identity of pad.connectedTo) {
      const net = this.getNet(identity)
      if (visitedNets.has(net)) continue
      visitedNets.add(net)
      const terminalPositions = this.terminalsByNet.get(net)
      if (!terminalPositions) continue
      for (const terminalPosition of terminalPositions) {
        const points = this.output[terminalPosition.routeIndex]!.route
        const index = terminalPosition.index === 0 ? 0 : points.length - 1
        const point = points[index]!
        if (!pad.__zLayers.includes(point.z) || !isPointInRect(point, pad))
          continue
        const opposite = points[index === 0 ? points.length - 1 : 0]!
        if (pad.__zLayers.includes(opposite.z) && isPointInRect(opposite, pad))
          continue
        found.set(terminalPosition.routeIndex, {
          routeIndex: terminalPosition.routeIndex,
          index,
        })
        if (found.size > 2) break
      }
      if (found.size > 2) break
    }
    if (found.size === 2)
      this.outcomes.push(
        this.simplifyPad(pad, [...found.values()] as [
          TerminalPosition,
          TerminalPosition,
        ]),
      )
    this.stats = {
      padsVisited: this.padIndex,
      replacements: this.lockedRoutes.size / 2,
    }
    if (this.padIndex === this.pads.length) this.solved = true
  }

  override getConstructorParams(): [PadJunctionSimplificationInput] {
    return [this.input]
  }

  override getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error(
        "PadJunctionSimplificationSolver: output requested before completion",
      )
    return this.output
  }

  override visualize(): GraphicsObject {
    return visualizePadJunctionSimplification(
      this.input,
      this.output,
      this.pads,
      this.solved ? undefined : this.pads[Math.max(0, this.padIndex - 1)],
    )
  }
}
