import {
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import {
  ConnectionNameResolver,
  SpatialObstacleIndex,
  type PowerTraceExpanderInput,
} from "@tscircuit/power-trace-expander"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import type { GraphicsObject } from "graphics-debug"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getDrcErrorSignatures } from "./getDrcErrorSignatures"

type Point = { x: number; y: number }
type Wire = Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" }>
type Via = Extract<SimplifiedPcbTrace["route"][number], { route_type: "via" }>
type ClearanceTarget = {
  traceIndex: number
  obstacle: AnyCircuitElement
  deficit: number
}
type Terminal = Point & { id: string; layers: string[] }

export type LocalDrcRepairInput = {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: SimplifiedPcbTraces
  fixedTraces: SimplifiedPcbTraces
}

const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y
const keyOf = (p: Point): string => `${p.x},${p.y}`
const CLEARANCE_MARGIN = 0.01

/**
 * Repairs independent conflicts in emitted copper, after width expansion.
 * Only coordinates of ordinary wire/via routes may change. Every changed wire
 * must be clearance-clean and every existing physical contact must survive.
 */
export class LocalDrcRepairSolver extends BaseSolver {
  private traces: SimplifiedPcbTraces
  private readonly resolver: ConnectionNameResolver
  private readonly indexInput: PowerTraceExpanderInput
  private index: SpatialObstacleIndex
  private readonly eligible: boolean[]
  private readonly terminalsByNet = new Map<string, Terminal[]>()
  private readonly traceClearance: number
  private readonly viaDimensions: ReturnType<typeof getViaDimensions>
  private readonly viaClearance: number
  private readonly mergedSites = new Map<string, string>()
  private readonly viaGroups: PcbVia[][] = []
  private targets: ClearanceTarget[] = []
  private cursor = 0
  private phase: "setup" | "vias" | "clearances" | "verify" = "setup"
  private reference: EvaluateRelaxedDrcResult | undefined
  private phaseInput: SimplifiedPcbTraces
  private readonly board: ReturnType<typeof createPcbBoardElement>

  constructor(public readonly input: LocalDrcRepairInput) {
    super()
    this.traces = input.traces
    this.phaseInput = input.traces
    this.traceClearance = Math.max(
      0.1,
      input.originalSrj.minTraceToPadEdgeClearance ?? 0,
      input.originalSrj.defaultObstacleMargin ?? 0,
    )
    this.viaClearance = Math.max(
      0.1,
      input.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0,
    )
    this.viaDimensions = getViaDimensions(input.originalSrj)
    this.indexInput = {
      ...input.originalSrj,
      traces: input.traces,
      fixedTraces: this.materializeViaDimensions(input.fixedTraces),
    } as unknown as PowerTraceExpanderInput
    this.resolver = new ConnectionNameResolver(this.indexInput)
    this.index = this.createIndex(input.traces)
    this.board = createPcbBoardElement({
      ...input.originalSrj,
      minBoardEdgeClearance: input.originalSrj.minBoardEdgeClearance ?? 0,
    })
    this.stats = {
      attemptedViaSites: 0,
      mergedViaGroups: 0,
      attemptedClearanceMoves: 0,
      acceptedClearanceMoves: 0,
      referenceValidationCount: 0,
      rejectedPublicationCount: 0,
    }
    const protectedNets = new Set(
      this.resolver.canonicalize([
        ...(input.originalSrj.differentialPairs ?? []).flatMap(
          (pair) => pair.connectionNames,
        ),
        ...(input.originalSrj.buses ?? []).flatMap((bus) => bus.connectionNames),
      ]),
    )
    this.eligible = input.traces.map(
      (trace) =>
        !trace.__replaces_pcb_trace_id &&
        !this.resolver
          .canonicalize([trace.pcb_trace_id])
          .some((net) => protectedNets.has(net)) &&
        this.isContinuousOrdinaryTrace(trace),
    )
    // The spatial copper index models through vias and ordinary wire segments.
    // Keep unsupported copper fixed until those primitives have exact support.
    if (
      input.originalSrj.allowBlindAndBuriedVias ||
      [...input.traces, ...input.fixedTraces].some(
        (trace) => !this.isContinuousOrdinaryTrace(trace),
      )
    ) {
      this.stats.unsupportedGeometry = true
      this.solved = true
      return
    }
    for (const [ci, connection] of input.originalSrj.connections.entries()) {
      const nets = this.resolver.canonicalize([connection.name])
      for (const [pi, point] of connection.pointsToConnect.entries()) {
        for (const net of nets) {
          const terminals = this.terminalsByNet.get(net) ?? []
          terminals.push({
            x: point.x,
            y: point.y,
            id: `terminal:${ci}:${pi}`,
            layers: point.layers ?? [point.layer],
          })
          this.terminalsByNet.set(net, terminals)
        }
      }
    }
  }

  private materializeViaDimensions(
    traces: SimplifiedPcbTraces,
  ): NonNullable<PowerTraceExpanderInput["traces"]> {
    return traces.map((trace) => ({
      ...trace,
      route: trace.route.map((p) =>
        p.route_type === "via"
          ? {
              ...p,
              via_diameter: p.via_diameter ?? this.viaDimensions.padDiameter,
              via_hole_diameter:
                p.via_hole_diameter ?? this.viaDimensions.holeDiameter,
            }
          : p,
      ),
    })) as NonNullable<PowerTraceExpanderInput["traces"]>
  }

  private createIndex(traces: SimplifiedPcbTraces): SpatialObstacleIndex {
    return new SpatialObstacleIndex(
      this.indexInput,
      this.materializeViaDimensions(traces),
      undefined,
      [],
      this.resolver,
    )
  }

  private isContinuousOrdinaryTrace(trace: SimplifiedPcbTrace): boolean {
    if (
      trace.route[0]?.route_type !== "wire" ||
      trace.route.at(-1)?.route_type !== "wire"
    ) return false
    for (let i = 0; i < trace.route.length; i++) {
      const p = trace.route[i]!
      const previous = trace.route[i - 1]
      const next = trace.route[i + 1]
      if (p.route_type === "via") {
        if (
          previous?.route_type !== "wire" ||
          next?.route_type !== "wire" ||
          !samePoint(previous, p) ||
          !samePoint(next, p) ||
          previous.layer === next.layer ||
          ![p.from_layer, p.to_layer].includes(previous.layer) ||
          ![p.from_layer, p.to_layer].includes(next.layer)
        ) return false
      } else if (
        p.route_type !== "wire" ||
        (next?.route_type === "wire" && p.layer !== next.layer)
      ) return false
    }
    return true
  }

  private evaluate(traces: SimplifiedPcbTraces): EvaluateRelaxedDrcResult {
    this.stats.referenceValidationCount++
    return evaluateRelaxedDrc({
      inputSrj: { ...this.input.originalSrj, traces: this.input.fixedTraces },
      srjWithPointPairs: this.input.srjWithPointPairs,
      routedTraces: traces,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: this.traceClearance,
        viaClearance: this.viaClearance,
      },
    })
  }

  private prepareViaGroups(reference: EvaluateRelaxedDrcResult): void {
    const vias = new Map(
      reference.circuitJson
        .filter((e) => e.type === "pcb_via")
        .map((via) => [via.pcb_via_id, via]),
    )
    for (const error of reference.errors) {
      if (
        error.type !== "pcb_via_clearance_error" ||
        error.pcb_via_ids.length !== 2
      ) continue
      const a = vias.get(error.pcb_via_ids[0]!)
      const b = vias.get(error.pcb_via_ids[1]!)
      if (!a || !b) {
        throw new Error("Local DRC repair cannot find a clearance pair's vias")
      }
      // Resolve the owning traces' explicit aliases, not the checker's error ID.
      // Obstacle vias without an owning trace are not merge candidates.
      if (!a.pcb_trace_id || !b.pcb_trace_id) continue
      const aNets = this.resolver.canonicalize([a.pcb_trace_id])
      const bNets = this.resolver.canonicalize([b.pcb_trace_id])
      if (!aNets.some((net) => bNets.includes(net))) continue
      // Consolidate overlapping drills, not merely close but distinct vias.
      if (
        a.outer_diameter !== b.outer_diameter ||
        a.hole_diameter !== b.hole_diameter ||
        a.layers.join() !== b.layers.join() ||
        Math.hypot(a.x - b.x, a.y - b.y) >=
          (a.hole_diameter + b.hole_diameter) / 2
      ) continue
      const groups = this.viaGroups.filter((group) =>
        group.some((via) => via === a || via === b),
      )
      const joined = [...new Set([a, b, ...groups.flat()])]
      for (const group of groups) this.viaGroups.splice(this.viaGroups.indexOf(group), 1)
      this.viaGroups.push(joined)
    }
    for (const group of this.viaGroups) {
      const identity = group.map(keyOf).sort().join(";")
      for (const via of group) this.mergedSites.set(keyOf(via), identity)
    }
  }

  private isLocked(trace: SimplifiedPcbTrace, index: number): boolean {
    const p = trace.route[index]!
    return (
      index === 0 ||
      index === trace.route.length - 1 ||
      (p.route_type === "wire" &&
        Boolean(p.start_pcb_port_id || p.end_pcb_port_id))
    )
  }

  private getContacts(
    trace: SimplifiedPcbTrace,
    traceIndex: number,
    index: SpatialObstacleIndex,
  ): Set<string> {
    const contacts = new Set<string>()
    const names = [trace.pcb_trace_id]
    const terminals = this.resolver
      .canonicalize(names)
      .flatMap((net) => this.terminalsByNet.get(net) ?? [])
    for (let i = 0; i < trace.route.length; i++) {
      const p = trace.route[i]!
      const next = trace.route[i + 1]
      const primitives = p.route_type === "via"
        ? index.boardLayers.map((layer) => ({ start: p, end: p, width: p.via_diameter ?? this.viaDimensions.padDiameter, layer }))
        : p.route_type === "wire" && next?.route_type === "wire" && p.layer === next.layer
          ? [{ start: p, end: next, width: p.width, layer: p.layer }]
          : []
      for (const primitive of primitives) {
        for (const id of index.getSameNetCopperContactIds({ ...primitive, connectionNames: names, ignoreTraceIndex: traceIndex })) contacts.add(id)
        for (const terminal of terminals) {
          if (terminal.layers.includes(primitive.layer) && pointToSegmentDistance(terminal, primitive.start, primitive.end) <= primitive.width / 2 + 1e-9) contacts.add(terminal.id)
        }
      }
    }
    return contacts
  }

  private acceptGeometry(
    candidate: SimplifiedPcbTraces,
    changed: Set<number>,
  ): boolean {
    const candidateIndex = this.createIndex(candidate)
    for (const ti of changed) {
      const before = this.traces[ti]!
      const after = candidate[ti]!
      const movedSegments: PcbTrace[] = []
      // The broad-phase obstacle index encloses ovals with rectangles. That is
      // conservative for foreign copper but cannot prove a solder contact.
      // Keep any primitive touching such a same-net obstacle fixed.
      for (let i = 0; i < before.route.length; i++) {
        const p = before.route[i]!, q = after.route[i]!
        if ((p.route_type !== "wire" && p.route_type !== "via") || (q.route_type !== "wire" && q.route_type !== "via")) continue
        const next = before.route[i + 1], nextAfter = after.route[i + 1]
        const moved = !samePoint(p, q) || (next?.route_type === "wire" && nextAfter?.route_type === "wire" && !samePoint(next, nextAfter))
        if (!moved) continue
        const queries = p.route_type === "via"
          ? this.index.boardLayers.map((layer) => ({ start: p, end: p, width: p.via_diameter ?? this.viaDimensions.padDiameter, layer }))
          : next?.route_type === "wire" && p.layer === next.layer
            ? [{ start: p, end: next, width: p.width, layer: p.layer }]
            : []
        for (const query of queries) {
          for (const contact of this.index.getSameNetCopperContactIds({ ...query, connectionNames: [before.pcb_trace_id], ignoreTraceIndex: ti })) {
            if (contact.startsWith("obstacle:") && this.indexInput.obstacles[Number(contact.slice(9))]!.type === "oval") return false
          }
        }
      }
      for (let i = 0; i < after.route.length - 1; i++) {
        const a = after.route[i]!, b = after.route[i + 1]!
        const oldA = before.route[i]!, oldB = before.route[i + 1]!
        if (a.route_type !== "wire" || b.route_type !== "wire" || oldA.route_type !== "wire" || oldB.route_type !== "wire" || a.layer !== b.layer || (samePoint(a, oldA) && samePoint(b, oldB))) continue
        if (candidateIndex.collides({ start: a, end: b, layer: a.layer, width: a.width, connectionNames: [after.pcb_trace_id] })) return false
        movedSegments.push({ type: "pcb_trace", pcb_trace_id: after.pcb_trace_id, source_trace_id: "", route: [a, b] as PcbTrace["route"] })
      }
      if (checkPcbTracesOutOfBoard([this.board, ...movedSegments]).length > 0) return false
      const contacts = this.getContacts(after, ti, candidateIndex)
      for (const contact of this.getContacts(before, ti, this.index)) {
        if (!contacts.has(contact)) return false
      }
    }
    this.traces = candidate
    this.index = candidateIndex
    return true
  }

  private mergeViaGroup(group: PcbVia[]): void {
    const net = this.resolver.canonicalize([group[0]!.pcb_trace_id!])[0]!
    for (const target of group) {
      this.stats.attemptedViaSites++
      const removedSites = new Set(group.filter((via) => !samePoint(via, target)).map(keyOf))
      if (this.input.fixedTraces.some((trace) => trace.route.some((p) => p.route_type === "via" && removedSites.has(keyOf(p))))) continue
      const candidate = [...this.traces]
      const changed = new Set<number>()
      let locked = false
      for (const [ti, trace] of this.traces.entries()) {
        if (!this.resolver.canonicalize([trace.pcb_trace_id]).includes(net)) continue
        const moving = trace.route.flatMap((p, i) => (p.route_type === "wire" || p.route_type === "via") && removedSites.has(keyOf(p)) ? [i] : [])
        if (moving.length === 0) continue
        if (!this.eligible[ti] || moving.some((i) => {
          const p = trace.route[i]!
          return this.isLocked(trace, i) || (p.route_type === "via" && (
            (p.via_diameter ?? this.viaDimensions.padDiameter) !== target.outer_diameter ||
            (p.via_hole_diameter ?? this.viaDimensions.holeDiameter) !== target.hole_diameter
          ))
        })) { locked = true; break }
        const route = [...trace.route]
        for (const i of moving) route[i] = { ...route[i]!, x: target.x, y: target.y } as Wire | Via
        candidate[ti] = { ...trace, route }
        changed.add(ti)
      }
      if (locked || changed.size === 0) continue
      // The kept drill already exists on this net, with identical dimensions
      // and layer span. No new via footprint or drill/pad contact is introduced.
      if (this.acceptGeometry(candidate, changed)) {
        this.stats.mergedViaGroups++
        return
      }
    }
  }

  private prepareClearanceTargets(reference: EvaluateRelaxedDrcResult): void {
    const traceIndices = new Map(this.traces.map((trace, i) => [trace.pcb_trace_id, i]))
    const obstacles = new Map<string, AnyCircuitElement>()
    for (const e of reference.circuitJson) {
      if (e.type === "pcb_via") obstacles.set(e.pcb_via_id, e)
      else if (e.type === "pcb_smtpad") obstacles.set(e.pcb_smtpad_id, e)
      else if (e.type === "pcb_plated_hole") obstacles.set(e.pcb_plated_hole_id, e)
    }
    this.targets = reference.errors.flatMap((error): ClearanceTarget[] => {
      if (error.type !== "pcb_via_trace_clearance_error" && error.type !== "pcb_pad_trace_clearance_error") return []
      const traceIndex = traceIndices.get(error.pcb_trace_id)
      if (traceIndex === undefined || !this.eligible[traceIndex]) return []
      const id = error.type === "pcb_via_trace_clearance_error" ? error.pcb_via_id : error.pcb_pad_id
      const obstacle = obstacles.get(id)
      if (!obstacle) throw new Error(`Local DRC repair cannot find obstacle ${id}`)
      if (typeof error.minimum_clearance !== "number" || typeof error.actual_clearance !== "number" || !Number.isFinite(error.actual_clearance)) throw new Error("Local DRC repair requires measured clearance")
      return [{ traceIndex, obstacle, deficit: error.minimum_clearance - error.actual_clearance }]
    }).sort((a, b) => a.deficit - b.deficit)
  }

  private measureGap(a: Wire, b: Wire, obstacle: AnyCircuitElement): number {
    const trace: PcbTrace = { type: "pcb_trace", pcb_trace_id: "local-clearance-measurement", source_trace_id: "", route: [a, b] as PcbTrace["route"] }
    const options = { minClearance: this.traceClearance + 1 }
    const errors = obstacle.type === "pcb_via" ? checkViaTraceClearance([trace, obstacle], options) : checkPadTraceClearance([trace, obstacle], options)
    // This narrow-phase query only ranks already non-overlapping pairs. The
    // spatial guard checks every changed segment for overlaps before acceptance.
    if (errors.length === 0) return Infinity
    const gap = errors[0]!.actual_clearance
    if (typeof gap !== "number" || !Number.isFinite(gap)) throw new Error("Local DRC repair requires a finite gap")
    return gap
  }

  private moveClearanceTarget(target: ClearanceTarget): void {
    const trace = this.traces[target.traceIndex]!
    let best: { index: number; gap: number } | undefined
    for (let i = 0; i < trace.route.length - 1; i++) {
      const a = trace.route[i]!, b = trace.route[i + 1]!
      if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
      const gap = this.measureGap(a, b, target.obstacle)
      if (!best || gap < best.gap) best = { index: i, gap }
    }
    if (!best || best.gap >= this.traceClearance) return
    const i = best.index
    const a = trace.route[i] as Wire, b = trace.route[i + 1] as Wire
    const previous = trace.route[i - 1], next = trace.route[i + 2]
    if (this.isLocked(trace, i) || this.isLocked(trace, i + 1) || previous?.route_type !== "wire" || next?.route_type !== "wire" || previous.layer !== a.layer || next.layer !== a.layer) return
    const displacement = this.traceClearance + CLEARANCE_MARGIN - best.gap
    // A local nudge moves less than half a trace width. Larger conflicts need
    // coordinated rerouting, not progressively larger blind displacements.
    if (displacement > a.width / 2) return
    const h = Math.min(a.width / 100, best.gap / 4)
    if (h <= 0) return
    const shiftedGap = (dx: number, dy: number): number => this.measureGap({ ...a, x: a.x + dx, y: a.y + dy }, { ...b, x: b.x + dx, y: b.y + dy }, target.obstacle)
    const gx = (shiftedGap(h, 0) - shiftedGap(-h, 0)) / (2 * h)
    const gy = (shiftedGap(0, h) - shiftedGap(0, -h)) / (2 * h)
    const length = Math.hypot(gx, gy)
    if (!Number.isFinite(length) || length < 1e-6) return
    const dx = displacement * gx / length, dy = displacement * gy / length
    const candidate = [...this.traces]
    const route = [...trace.route]
    route[i] = { ...a, x: a.x + dx, y: a.y + dy }
    route[i + 1] = { ...b, x: b.x + dx, y: b.y + dy }
    candidate[target.traceIndex] = { ...trace, route }
    this.stats.attemptedClearanceMoves++
    if (this.acceptGeometry(candidate, new Set([target.traceIndex]))) this.stats.acceptedClearanceMoves++
  }

  private verifyPhase(): void {
    if (this.traces === this.phaseInput) return
    const candidate = this.evaluate(this.traces)
    const previousErrors = getDrcErrorSignatures(this.reference!, this.mergedSites)
    const regression = [...getDrcErrorSignatures(candidate, this.mergedSites)].some(
      ([key, gap]) => !previousErrors.has(key) || gap < previousErrors.get(key)! - 1e-9,
    )
    if (!regression && candidate.errors.length < this.reference!.errors.length) {
      this.reference = candidate
    } else {
      // Candidate rejection is part of repair search: never publish a batch
      // unless the complete reference checker confirms a strict improvement.
      this.traces = this.phaseInput
      this.index = this.createIndex(this.traces)
      if (this.phase === "vias") this.stats.mergedViaGroups = 0
      else this.stats.acceptedClearanceMoves = 0
      this.stats.rejectedPublicationCount++
    }
    this.phaseInput = this.traces
  }

  override _step(): void {
    if (this.phase === "setup") {
      this.reference = this.evaluate(this.traces)
      this.stats.initialDrcIssueCount = this.reference.errors.length
      if (this.reference.errors.length === 0) {
        this.stats.finalDrcIssueCount = 0
        this.solved = true
        return
      }
      this.prepareViaGroups(this.reference)
      this.MAX_ITERATIONS = this.reference.errors.length * 2 + 6
      this.phase = "vias"
    } else if (this.phase === "vias") {
      if (this.cursor < this.viaGroups.length) {
        this.mergeViaGroup(this.viaGroups[this.cursor++]!)
        return
      }
      this.verifyPhase()
      this.stats.postMergeDrcIssueCount = this.reference!.errors.length
      this.prepareClearanceTargets(this.reference!)
      this.cursor = 0
      this.phase = "clearances"
    } else if (this.phase === "clearances") {
      if (this.cursor < this.targets.length) {
        this.moveClearanceTarget(this.targets[this.cursor++]!)
        return
      }
      this.phase = "verify"
    } else {
      this.verifyPhase()
      this.stats.finalDrcIssueCount = this.reference!.errors.length
      this.solved = true
    }
  }

  override getConstructorParams(): [LocalDrcRepairInput] {
    return [this.input]
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({
      ...this.input.originalSrj,
      traces: [...this.input.fixedTraces, ...this.traces],
    }, { traceColorMode: "layer" })
  }

  override getOutput(): SimplifiedPcbTraces {
    if (!this.solved) {
      throw new Error("Cannot get local DRC repair output before solving")
    }
    return this.traces
  }
}
