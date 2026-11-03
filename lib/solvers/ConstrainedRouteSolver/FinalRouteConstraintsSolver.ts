import type { SimpleRouteConstraint, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { BaseSolver } from "../BaseSolver"
import { ConstrainedClearanceRepairSolver } from "./ConstrainedClearanceRepairSolver"
import { ConstrainedRouteSolver } from "./ConstrainedRouteSolver"
import { measureRouteConstraint } from "./measureRouteConstraint"

/** Recheck the emitted copper after DRC repair, which can lengthen a clock path. */
export class FinalRouteConstraintsSolver extends BaseSolver {
  traces: SimplifiedPcbTrace[]
  replacedTraceIds = new Set<string>()
  private clearance?: ConstrainedClearanceRepairSolver
  private pending: SimpleRouteConstraint[]

  constructor(public readonly srj: SimpleRouteJson, traces: readonly SimplifiedPcbTrace[]) {
    super()
    this.traces = [...traces]
    this.pending = [...(srj.routeConstraints ?? [])]
    this.MAX_ITERATIONS = this.pending.length + 1
  }

  override _step(): void {
    if (this.clearance) {
      this.clearance.step()
      if (this.clearance.failed) { this.failed = true; this.error = this.clearance.error; return }
      if (this.clearance.solved) { this.traces = this.clearance.traces; this.solved = true; this.activeSubSolver = null }
      return
    }
    const rule = this.pending.shift()
    if (!rule) {
      this.clearance = new ConstrainedClearanceRepairSolver(this.srj, this.traces)
      this.activeSubSolver = this.clearance
      this.MAX_ITERATIONS += this.clearance.MAX_ITERATIONS + 1
      return
    }
    if (measureRouteConstraint(this.srj, this.traces, rule).satisfied) return
    const connection = this.srj.connections.find((candidate) => candidate.name === rule.connectionName)!
    // A two-terminal clock can be replaced without deleting any branches.
    // Multi-terminal path limits are validated, never replaced wholesale.
    if (rule.maxViaCount === 0 && connection.pointsToConnect.length === 2) {
      const connectivity = getConnectivityMapFromSimpleRouteJson({ ...this.srj, traces: this.traces })
      const net = connectivity.getNetConnectedToId(connection.name)
      const oldClock = this.traces.filter((trace) => net && connectivity.getNetConnectedToId(trace.connection_name) === net)
      const otherCopper = this.traces.filter((trace) => !oldClock.includes(trace))
      const repair = new ConstrainedRouteSolver({ ...this.srj, traces: otherCopper, routeConstraints: [rule] })
      repair.solve()
      if (repair.solved) {
        const newClock = repair.outputSrj.traces!.filter((trace) => repair.newTraceIds.has(trace.pcb_trace_id))
        if (newClock.length !== 1 || oldClock.length !== 1) {
          this.failed = true
          this.error = `Cannot replace fragmented routing for ${rule.name ?? "constrained trace"}`
          return
        }
        const oldTrace = oldClock[0]!
        const repaired = { ...newClock[0]!, pcb_trace_id: oldTrace.pcb_trace_id,
          connectsTo: oldTrace.connectsTo ?? newClock[0]!.connectsTo,
          __replaces_pcb_trace_id: oldTrace.__replaces_pcb_trace_id ?? (this.srj.traces?.some((trace) => trace.pcb_trace_id === oldTrace.pcb_trace_id) ? oldTrace.pcb_trace_id : undefined) }
        this.traces = [...otherCopper, repaired]
        this.replacedTraceIds.add(repaired.pcb_trace_id)
      }
    }
    if (!measureRouteConstraint(this.srj, this.traces, rule).satisfied) {
      this.failed = true
      this.error = `Route for ${rule.name ?? "constrained trace"} does not satisfy its via/length limits`
    }
  }
}
