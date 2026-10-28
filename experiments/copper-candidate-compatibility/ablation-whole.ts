import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { PriorityDagIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { runAllRoutingChecks, checkCopperToBoardEdgeClearance, checkViasOffBoard } from "@tscircuit/checks"
import { loadScenarioBySampleNumber, toSimpleRouteJson, type DatasetName } from "../../scripts/benchmark/scenarios"

const arms = {
  control: { copperCandidateSearch: false, copperUnpriceFutureCosts: false },
  "soft-only": { copperCandidateSearch: false, copperUnpriceFutureCosts: true },
  "archive-only": { copperCandidateSearch: true, copperUnpriceFutureCosts: false },
  full: { copperCandidateSearch: true, copperUnpriceFutureCosts: true },
}
const dataset = process.argv[2] as DatasetName
const sample = Number(process.argv[3])
const arm = process.argv[4] as keyof typeof arms
const outputDirectory = process.argv[5]
if (!arms[arm] || !outputDirectory || !Number.isSafeInteger(sample)) throw new Error("Usage: ablation-whole.ts DATASET SAMPLE ARM OUTPUT_DIRECTORY")
const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
const converted = toSimpleRouteJson(scenario)
if (!converted) throw new Error("Scenario is not SimpleRouteJson")
const srj = { ...converted, effort: 1 }
const original = structuredClone(srj)
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const inputHash = hash(original)
type WitnessProbe = { id: number; route: unknown } | undefined
type StateProbe = { witnesses: WitnessProbe[] } | undefined
const assignmentEvents = new Map<PriorityDagIntraNodeSolver, Record<string, unknown>[]>()
const stepSelection = Reflect.get(PriorityDagIntraNodeSolver.prototype, "stepCandidateSearch")
Reflect.set(PriorityDagIntraNodeSolver.prototype, "stepCandidateSearch", function (this: PriorityDagIntraNodeSolver): boolean {
  const beforeState = Reflect.get(this, "current") as StateProbe
  const foundBefore = this.priorityDiagnostics.copperCandidateAssignmentsFound ?? 0
  const result = stepSelection.call(this)
  if ((this.priorityDiagnostics.copperCandidateAssignmentsFound ?? 0) > foundBefore) {
    const afterState = Reflect.get(this, "current") as StateProbe
    if (!afterState) throw new Error("Found assignment lacks proposed state")
    const changes = afterState.witnesses.map((witness, task) => {
      const previous = beforeState?.witnesses[task]
      return { task, hadPriorWitness: Boolean(previous), beforeId: previous?.id, afterId: witness?.id, beforeHash: previous ? hash(previous.route) : null, afterHash: witness ? hash(witness.route) : null }
    })
    const changedGeometry = changes.filter((change) => change.hadPriorWitness && change.beforeHash !== change.afterHash).map((change) => ({
      task: change.task,
      beforeRoute: beforeState!.witnesses[change.task]!.route,
      afterRoute: afterState.witnesses[change.task]!.route,
    }))
    const events = assignmentEvents.get(this) ?? []
    events.push({
      outcome: "pending-or-preempted", nodeId: this.nodeWithPortPoints.capacityMeshNodeId, changes,
      ...(changedGeometry.length ? {
        changedGeometry,
        nodeInput: structuredClone(this.nodeWithPortPoints),
        context: {
          netMap: structuredClone(this.connMap?.netMap),
          hyperParameters: this.hyperParameters,
          viaDiameter: this.viaDiameter,
          viaHoleDiameter: Reflect.get(this, "viaHoleDiameter"),
          minViaHoleEdgeToViaHoleEdgeClearance: Reflect.get(this, "minimumHoleGap"),
          traceWidth: this.traceWidth,
          obstacleMargin: this.obstacleMargin,
          board: Reflect.get(this, "board"),
          priorityFamilySize: this.familySize,
          coordinateScale: this.coordinateScale,
          effectiveOptions: { copperCandidateSearch: this.copperCandidateSearch, copperUnpriceFutureCosts: this.copperUnpriceFutureCosts },
        },
      } : {}),
    })
    assignmentEvents.set(this, events)
  }
  return result
})
const recordCandidate = Reflect.get(PriorityDagIntraNodeSolver.prototype, "recordCandidate")
Reflect.set(PriorityDagIntraNodeSolver.prototype, "recordCandidate", function (this: PriorityDagIntraNodeSolver, name: string, count?: number): void {
  recordCandidate.call(this, name, count)
  if (name === "copperCandidateAssignmentsPublished" || name === "copperCandidateRejectedAssignments") {
    const event = assignmentEvents.get(this)?.at(-1)
    if (!event) throw new Error("Assignment outcome lacks captured proposal")
    event.outcome = name === "copperCandidateAssignmentsPublished" ? "published" : "rejected"
  }
})
const allCandidates = new Set<ReturnType<PortfolioSingleIntraNodeSolver["generateSolver"]>>()
const generated = PortfolioSingleIntraNodeSolver.prototype.generateSolver
PortfolioSingleIntraNodeSolver.prototype.generateSolver = function (hyperParameters) {
  const candidate = generated.call(this, hyperParameters)
  if (!candidate || allCandidates.has(candidate)) {
    if (!candidate) throw new Error("Candidate factory returned no candidate")
    return candidate
  }
  allCandidates.add(candidate)
  return candidate
}
const solver = new Pipeline9(srj, { cacheProvider: null, effort: 1, ...arms[arm] })
solver.solve()
const candidates = [...allCandidates]
const priority = candidates.filter((candidate): candidate is PriorityDagIntraNodeSolver => candidate instanceof PriorityDagIntraNodeSolver)
if (priority.some((candidate) => candidate.copperCandidateSearch !== arms[arm].copperCandidateSearch || candidate.copperUnpriceFutureCosts !== arms[arm].copperUnpriceFutureCosts)) throw new Error("Ablation option propagation failed")
const traces = solver.solved ? solver.getOutputSimplifiedPcbTraces() : null
const context = solver.srjWithPointPairs
if (solver.solved && (!traces || !context)) throw new Error("Solved board lacks output/context")
const reference = traces && context ? evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: context, routedTraces: traces, includeBoardClearance: true, drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance, includeTraceContinuity: true, includeTypedTraceClearance: true } }) : null
const library = reference ? await runAllRoutingChecks(structuredClone(reference.circuitJson)) : null
const summarize = (errors: Array<{ type?: string }> | null): unknown => {
  if (!errors) return null
  const byType: Record<string, number> = {}
  for (const error of errors) {
    const type = String(error.type ?? "unknown")
    byType[type] = (byType[type] ?? 0) + 1
  }
  return { count: errors.length, byType }
}
let copperLength = 0
let vias = 0
let points = 0
for (const trace of traces ?? []) {
  points += trace.route.length
  for (let index = 0; index < trace.route.length; index++) {
    const a = trace.route[index], b = trace.route[index + 1]
    if (a.route_type === "via") vias++
    if (a.route_type === "wire" && b?.route_type === "wire" && a.layer === b.layer) copperLength += Math.hypot(a.x - b.x, a.y - b.y)
  }
}
const ledger = candidates.map((candidate) => ({
  className: candidate.constructor.name, iterations: candidate.iterations,
  maxIterations: candidate.MAX_ITERATIONS, solved: candidate.solved, failed: candidate.failed,
  nodeId: candidate.nodeWithPortPoints.capacityMeshNodeId,
  ...(candidate instanceof PriorityDagIntraNodeSolver ? {
    effectiveOptions: { copperCandidateSearch: candidate.copperCandidateSearch, copperUnpriceFutureCosts: candidate.copperUnpriceFutureCosts },
    diagnostics: candidate.priorityDiagnostics,
  } : {}),
}))
const result = {
  dataset, sample, arm, effectiveOptions: arms[arm], inputHash,
  inputMutated: hash(srj) !== inputHash,
  solved: solver.solved, failed: solver.failed, error: solver.error, phase: solver.getCurrentPhase(),
  totalIterations: solver.iterations, highDensityIterations: solver.highDensityRouteSolver?.iterations,
  priorityCandidateCount: priority.length,
  allPriorityChargedIterations: priority.reduce((total, candidate) => total + candidate.iterations, 0),
  preemptedPriorityCandidateCount: priority.filter((candidate) => !candidate.solved && !candidate.failed).length,
  preemptedPriorityChargedIterations: priority.filter((candidate) => !candidate.solved && !candidate.failed).reduce((total, candidate) => total + candidate.iterations, 0),
  aggregateDiagnostics: solver.highDensityRouteSolver?.benchmarkDiagnosticCounters,
  assignmentEvents: [...assignmentEvents.values()].flat(),
  referenceChecks: summarize(reference?.errors ?? null),
  boardChecks: summarize(reference ? checkCopperToBoardEdgeClearance(reference.circuitJson) : null),
  viaBoardChecks: summarize(reference ? checkViasOffBoard(reference.circuitJson) : null),
  libraryChecks: summarize(library),
  traceCount: traces?.length ?? null, routeViaCount: vias, routePointCount: points, summedWireLength: copperLength,
  rawTraceHash: traces ? hash(traces) : null,
  tracePayloadHash: traces ? hash(traces.map(({ pcb_trace_id, ...trace }) => trace).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) : null,
  ledger,
  limits: "Local functional/causal control, not a timing benchmark. Every constructed PriorityDag object is retained by identity, including preempted supervisors. Charged policy clocks are not CPU instructions or a sum over all solver-family work. Raw via occurrences do not deduplicate owned physical sites. Original reference and broader library coverage remain separate.",
}
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(`${outputDirectory}/result.json`, JSON.stringify(result, null, 2) + "\n")
writeFileSync(`${outputDirectory}/original-input.json`, JSON.stringify(original))
if (context) writeFileSync(`${outputDirectory}/point-pair-context.json`, JSON.stringify(context))
if (traces) writeFileSync(`${outputDirectory}/raw-traces.json`, JSON.stringify(traces))
if (reference) writeFileSync(`${outputDirectory}/reference-errors.json`, JSON.stringify(reference.errors))
if (reference) writeFileSync(`${outputDirectory}/circuit-json.json`, JSON.stringify(reference.circuitJson))
if (library) writeFileSync(`${outputDirectory}/library-errors.json`, JSON.stringify(library))
console.log(JSON.stringify({ ...result, ledger: undefined }))
