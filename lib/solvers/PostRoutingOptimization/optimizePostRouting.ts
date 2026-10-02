import type { SimplifiedPcbTrace } from "../../types"
import { UnsupportedPostRoutingInputError } from "./UnsupportedPostRoutingInputError"
import {
  createDynamicNetTreeProblem,
  type PostRoutingPhysicalInput,
} from "../DynamicNetTreeSolver/createDynamicNetTreeProblem"
import {
  routeDynamicNetTreeSteps,
  type DynamicNetTreeProgress,
  type DynamicNetTreeResult,
} from "../DynamicNetTreeSolver/routeDynamicNetTree"
import {
  measurePostRoutingMetrics,
  type PostRoutingMetrics,
} from "./measurePostRoutingMetrics"
import {
  validatePostRoutingCandidate,
  type PostRoutingValidation,
} from "./validatePostRoutingCandidate"

export type PostRoutingOptimizationInput = {
  /** Original physical input, with whole-net connections rather than point pairs. */
  srj: PostRoutingPhysicalInput
  /** Completed router output. Input srj.traces are protected preloaded copper. */
  traces: SimplifiedPcbTrace[]
  /** Explicit connection-name to whole-net ownership, including router aliases. */
  traceOwners: ReadonlyMap<string, string>
}
export type PostRoutingNetPlan = {
  net: string
  maxNewVias: number
  maxNewViasPerBranch: number
  componentPlanning?: "zero-via-forest"
}
export type PostRoutingObjective = {
  /** Lexicographic minimization, with strict improvement required. */
  priorities: (keyof PostRoutingMetrics)[]
  /** Absolute permitted increases from the original whole-board metrics. */
  maxCopperLengthIncrease: number
  maxBendIncrease: number
  maxChangedNets: number
}
export type PostRoutingOptimizationOptions = {
  enabled: boolean
  /** One transaction, in this order; no automatic sweep or retry portfolio. */
  nets: PostRoutingNetPlan[]
  objective: PostRoutingObjective
  search: {
    gridStep: number
    viaCost: number
    bendCost: number
    maxExpansions: number
    maxMilliseconds: number
  }
  /** Optional additional whole-board manufacturing/native checker. Called on
   * isolated copies of both original and candidate; cannot mutate the result. */
  validate?: (input: PostRoutingOptimizationInput) => PostRoutingValidation
}
export type PostRoutingChange = {
  net: string
  removedTraceIds: string[]
  addedTraceIds: string[]
  before: PostRoutingMetrics
  after: PostRoutingMetrics
}
export type PostRoutingOptimizationResult = {
  status: "disabled" | "accepted" | "rejected" | "unsupported"
  /** Unsupported output is preserved, not certified as physically valid. */
  validationStatus: "unchecked" | "unsupported" | "validated"
  traces: SimplifiedPcbTrace[]
  changedNets: string[]
  changes: PostRoutingChange[]
  before: PostRoutingMetrics | null
  after: PostRoutingMetrics | null
  candidateMetrics: PostRoutingMetrics | null
  diagnostics: string[]
  attempts: {
    net: string
    solved: boolean
    error?: string
    stats: DynamicNetTreeResult["stats"]
  }[]
  searchMilliseconds: number
  validationMilliseconds: number
}

/** Explicit final phase, called after a router has produced complete traces.
 * Only selected mutable nets are replaced. A rejection returns an exact clone
 * of all original traces and reports why; partial candidates never escape. */
function* optimizationSteps(
  input: PostRoutingOptimizationInput,
  options: PostRoutingOptimizationOptions,
): Generator<PostRoutingProgress, PostRoutingOptimizationResult> {
  const original = structuredClone(input.traces),
    srj = structuredClone(input.srj)
  const owners = new Map(input.traceOwners)
  const result: PostRoutingOptimizationResult = {
    status: options.enabled ? "rejected" : "disabled",
    validationStatus: "unchecked",
    traces: structuredClone(original),
    changedNets: [],
    changes: [],
    before: null,
    after: null,
    candidateMetrics: null,
    diagnostics: [],
    attempts: [],
    searchMilliseconds: 0,
    validationMilliseconds: 0,
  }
  if (!options.enabled) return result
  const settings = structuredClone({
    nets: options.nets,
    objective: options.objective,
    search: options.search,
  })
  const { objective, search, nets } = settings
  const metrics = new Set<keyof PostRoutingMetrics>([
    "viaSites",
    "copperLength",
    "bends",
  ])
  if (
    !nets.length ||
    new Set(nets.map((p) => p.net)).size !== nets.length ||
    !objective.priorities.length ||
    new Set(objective.priorities).size !== objective.priorities.length ||
    objective.priorities.some((m) => !metrics.has(m))
  )
    throw new Error("Declare distinct nets and objective priorities")
  if (
    ![
      objective.maxCopperLengthIncrease,
      objective.maxBendIncrease,
      objective.maxChangedNets,
      ...Object.values(search),
    ].every(Number.isFinite) ||
    objective.maxCopperLengthIncrease < 0 ||
    !Number.isInteger(objective.maxBendIncrease) ||
    objective.maxBendIncrease < 0 ||
    !Number.isInteger(objective.maxChangedNets) ||
    objective.maxChangedNets < 0 ||
    search.gridStep <= 0 ||
    search.viaCost < 0 ||
    search.bendCost < 0 ||
    !Number.isInteger(search.maxExpansions) ||
    search.maxExpansions < 1 ||
    search.maxMilliseconds <= 0
  )
    throw new Error("Invalid explicit optimization budgets")
  for (const plan of nets) {
    if (!srj.connections.some((c) => c.name === plan.net))
      throw new Error(`Unknown optimization net ${plan.net}`)
    if (
      ![plan.maxNewVias, plan.maxNewViasPerBranch].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 32,
      ) ||
      (plan.componentPlanning !== undefined &&
        plan.componentPlanning !== "zero-via-forest")
    )
      throw new Error(`Invalid net plan ${plan.net}`)
  }
  for (const connection of srj.connections) {
    if (
      owners.has(connection.name) &&
      owners.get(connection.name) !== connection.name
    )
      throw new Error(`Conflicting root net owner ${connection.name}`)
    owners.set(connection.name, connection.name)
  }
  const protectedIds = new Set(
    (srj.traces ?? []).map((trace) => trace.pcb_trace_id),
  )
  for (const fixed of srj.traces ?? []) {
    const actual = original.filter((t) => t.pcb_trace_id === fixed.pcb_trace_id)
    if (
      actual.length !== 1 ||
      JSON.stringify(actual[0]) !== JSON.stringify(fixed)
    )
      throw new Error(
        `Preloaded copper changed before optimization: ${fixed.pcb_trace_id}`,
      )
  }
  const validationStarted = performance.now()
  let baseline: PostRoutingValidation
  try {
    baseline = validatePostRoutingCandidate(srj, original, owners)
  } catch (error) {
    if (!(error instanceof UnsupportedPostRoutingInputError)) throw error
    result.status = "unsupported"
    result.validationStatus = "unsupported"
    result.diagnostics.push(error.message)
    result.validationMilliseconds += performance.now() - validationStarted
    return result
  }
  if (!baseline.valid)
    throw new Error(
      `Optimization requires a valid original board: ${baseline.diagnostics.join("; ")}`,
    )
  if (options.validate) {
    const extra = options.validate({
      srj: structuredClone(srj),
      traces: structuredClone(original),
      traceOwners: new Map(owners),
    })
    if (!extra.valid)
      throw new Error(
        `Original board failed additional validation: ${extra.diagnostics.join("; ")}`,
      )
  }
  result.validationMilliseconds += performance.now() - validationStarted
  result.validationStatus = "validated"
  result.before = measurePostRoutingMetrics(original, owners, srj)
  result.after = { ...result.before }
  const selected = new Set(nets.map((p) => p.net))
  const retained = original.filter(
    (trace) =>
      protectedIds.has(trace.pcb_trace_id) ||
      !selected.has(owners.get(trace.connection_name)!),
  )
  let candidate = structuredClone(retained),
    expansions = 0
  for (const plan of nets) {
    const remainingMs = search.maxMilliseconds - result.searchMilliseconds
    const remainingExpansions = search.maxExpansions - expansions
    if (remainingMs <= 0 || remainingExpansions <= 0) {
      result.diagnostics.push("Transaction search budget exhausted")
      break
    }
    const problem = createDynamicNetTreeProblem(
      srj,
      plan.net,
      candidate,
      owners,
    )
    const removed = original.filter(
      (trace) =>
        !protectedIds.has(trace.pcb_trace_id) &&
        owners.get(trace.connection_name) === plan.net,
    )
    const widths = new Set(
      removed.flatMap((trace) =>
        trace.route.filter((p) => p.route_type === "wire").map((p) => p.width),
      ),
    )
    if (widths.size > 1)
      throw new Error(
        `Mixed trace widths require an explicit adapter: ${plan.net}`,
      )
    if (widths.size) problem.width = [...widths][0]!
    const vias = removed.flatMap((trace) =>
      trace.route.filter((p) => p.route_type === "via"),
    )
    const diameters = new Set(
      vias.map((p) => p.via_diameter ?? problem.viaDiameter),
    )
    const holes = new Set(
      vias.map((p) => p.via_hole_diameter ?? problem.viaHoleDiameter),
    )
    if (diameters.size > 1 || holes.size > 1)
      throw new Error(
        `Mixed via sizes require an explicit adapter: ${plan.net}`,
      )
    if (diameters.size) problem.viaDiameter = [...diameters][0]!
    if (holes.size) problem.viaHoleDiameter = [...holes][0]!
    const steps = routeDynamicNetTreeSteps(problem, {
      ...search,
      maxMilliseconds: remainingMs,
      maxExpansions: remainingExpansions,
      maxViasPerNet: plan.maxNewVias,
      maxViasPerBranch: plan.maxNewViasPerBranch,
      componentPlanning: plan.componentPlanning,
    })
    let next = steps.next()
    while (!next.done) {
      yield {
        kind: "branch",
        traces: structuredClone([...candidate, ...next.value.traces]),
        event: next.value,
      }
      next = steps.next()
    }
    const routed = next.value
    result.searchMilliseconds += routed.stats.elapsedMs
    expansions += routed.stats.expansions
    result.attempts.push({
      net: plan.net,
      solved: routed.solved,
      error: routed.error,
      stats: routed.stats,
    })
    if (!routed.solved) {
      result.diagnostics.push(`Atomic rollback: ${plan.net}: ${routed.error}`)
      break
    }
    const usedIds = new Set(
      original
        .map((t) => t.pcb_trace_id)
        .concat(candidate.map((t) => t.pcb_trace_id)),
    )
    for (const trace of routed.traces) {
      const base = trace.pcb_trace_id
      let suffix = 0
      while (usedIds.has(trace.pcb_trace_id))
        trace.pcb_trace_id = `${base}:${++suffix}`
      usedIds.add(trace.pcb_trace_id)
    }
    candidate.push(...routed.traces)
  }
  if (
    result.searchMilliseconds > search.maxMilliseconds &&
    !result.diagnostics.length
  )
    result.diagnostics.push("Transaction search time exhausted")
  if (result.diagnostics.length) return result
  // Preserve all unaffected traces, in their original order, including prior
  // generated branches and protected preloads. IDs alone never waive this gate.
  const retainedIds = new Set(retained.map((t) => t.pcb_trace_id))
  if (
    JSON.stringify(candidate.filter((t) => retainedIds.has(t.pcb_trace_id))) !==
    JSON.stringify(retained)
  )
    throw new Error("Retained copper invariant violated")
  yield { kind: "proposal", traces: structuredClone(candidate) }
  const candidateValidationStarted = performance.now()
  const validation = validatePostRoutingCandidate(srj, candidate, owners)
  result.diagnostics.push(...validation.diagnostics)
  if (validation.valid && options.validate) {
    try {
      const extra = options.validate({
        srj: structuredClone(srj),
        traces: structuredClone(candidate),
        traceOwners: new Map(owners),
      })
      result.diagnostics.push(...extra.diagnostics)
      if (!extra.valid && !extra.diagnostics.length)
        result.diagnostics.push("Candidate failed additional validation")
    } catch (error) {
      result.diagnostics.push(`Additional validation failed: ${String(error)}`)
    }
  }
  result.validationMilliseconds +=
    performance.now() - candidateValidationStarted
  result.candidateMetrics = measurePostRoutingMetrics(candidate, owners, srj)
  if (result.diagnostics.length) return result
  const changes = nets
    .map(
      (plan): PostRoutingChange => ({
        net: plan.net,
        removedTraceIds: original
          .filter(
            (t) =>
              !retainedIds.has(t.pcb_trace_id) &&
              owners.get(t.connection_name) === plan.net,
          )
          .map((t) => t.pcb_trace_id),
        addedTraceIds: candidate
          .filter(
            (t) =>
              !retainedIds.has(t.pcb_trace_id) &&
              owners.get(t.connection_name) === plan.net,
          )
          .map((t) => t.pcb_trace_id),
        before: measurePostRoutingMetrics(
          original.filter((t) => owners.get(t.connection_name) === plan.net),
          owners,
          srj,
        ),
        after: measurePostRoutingMetrics(
          candidate.filter((t) => owners.get(t.connection_name) === plan.net),
          owners,
          srj,
        ),
      }),
    )
    .filter(
      (change) => change.removedTraceIds.length || change.addedTraceIds.length,
    )
  const before = result.before,
    after = result.candidateMetrics
  if (
    after.copperLength >
      before.copperLength + objective.maxCopperLengthIncrease + 1e-8 ||
    after.bends > before.bends + objective.maxBendIncrease ||
    changes.length > objective.maxChangedNets
  )
    result.diagnostics.push(
      "Candidate exceeds declared change/objective limits",
    )
  let improvement = false
  for (const metric of objective.priorities) {
    const difference = after[metric] - before[metric]
    if (Math.abs(difference) <= (metric === "copperLength" ? 1e-8 : 0)) continue
    improvement = difference < 0
    break
  }
  if (!improvement)
    result.diagnostics.push("No strict improvement under declared objective")
  if (result.diagnostics.length) return result
  result.status = "accepted"
  result.traces = candidate
  result.after = after
  result.changedNets = changes.map((change) => change.net)
  result.changes = changes
  return result
}

export type PostRoutingProgress = {
  kind: "branch" | "proposal"
  traces: SimplifiedPcbTrace[]
  event?: DynamicNetTreeProgress
}

/** Owns the proposal and immutable baseline across the two actual stages.
 * Only evaluate() can release an accepted output, after candidate validation.
 * Expected budget/objective rejections are reported; invariants still throw. */
export class PostRoutingOptimizationTransaction {
  private readonly input: PostRoutingOptimizationInput
  private readonly options: PostRoutingOptimizationOptions
  private readonly iterator: Generator<
    PostRoutingProgress,
    PostRoutingOptimizationResult
  >
  private snapshot: PostRoutingProgress
  private ready = false
  private result?: PostRoutingOptimizationResult

  constructor(
    input: PostRoutingOptimizationInput,
    options: PostRoutingOptimizationOptions,
  ) {
    this.input = {
      srj: structuredClone(input.srj),
      traces: structuredClone(input.traces),
      traceOwners: new Map(input.traceOwners),
    }
    this.options = {
      ...structuredClone({
        enabled: options.enabled,
        nets: options.nets,
        objective: options.objective,
        search: options.search,
      }),
      validate: options.validate,
    }
    this.snapshot = { kind: "proposal", traces: structuredClone(input.traces) }
    this.iterator = optimizationSteps(this.input, this.options)
  }

  advanceProposal(): boolean {
    if (this.ready) throw new Error("Post-routing proposal already completed")
    const next = this.iterator.next()
    if (next.done) {
      this.result = next.value
      this.ready = true
    } else {
      this.snapshot = next.value
      this.ready = next.value.kind === "proposal"
    }
    return this.ready
  }

  evaluate(): PostRoutingOptimizationResult {
    if (!this.ready)
      throw new Error(
        "Post-routing validation requested before proposal completion",
      )
    if (!this.result) {
      const next = this.iterator.next()
      if (!next.done)
        throw new Error("Unexpected proposal event during candidate validation")
      this.result = next.value
    }
    return structuredClone(this.result)
  }

  getSnapshot(): PostRoutingProgress {
    return structuredClone(this.snapshot)
  }
  getInput(): PostRoutingOptimizationInput {
    return {
      srj: structuredClone(this.input.srj),
      traces: structuredClone(this.input.traces),
      traceOwners: new Map(this.input.traceOwners),
    }
  }
}

/** Callable standalone phase; exactly the same transaction as Pipeline9. */
export function optimizePostRouting(
  input: PostRoutingOptimizationInput,
  options: PostRoutingOptimizationOptions,
): PostRoutingOptimizationResult {
  const transaction = new PostRoutingOptimizationTransaction(input, options)
  while (!transaction.advanceProposal()) {
    /* one recorded physical insertion */
  }
  return transaction.evaluate()
}
