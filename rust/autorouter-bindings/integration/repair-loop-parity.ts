import { AutoroutingDrcEngine } from "../../../lib/bindings/repair/AutoroutingDrcEngine"
import { addAutoroutingViaTraceIds } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { AnyCircuitElement } from "circuit-json"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { importReference } from "./tsReference"
const { GlobalDrcBranchPortfolioSolver } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
import { loadScenarioBySampleNumber } from "../../../scripts/benchmark/scenarios"
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await importReference<typeof import("../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")>("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
import type { RepairPortfolioDescriptor, RepairPortfolio } from "../../../lib/bindings/repair/repairPortfolio"
import type { GlobalDrcBranchPortfolioSolverParams } from "high-density-repair03/lib"
const { registerRepairPortfolioBackend } = await importReference<{ registerRepairPortfolioBackend: (factory: (params: GlobalDrcBranchPortfolioSolverParams, descriptor: RepairPortfolioDescriptor, reference: DrcEvaluator) => RepairPortfolio) => void }>("lib/solvers/DrcSolver/repairPortfolioBackend.ts")
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type SolverStateSnapshot = { solved: boolean; failed: boolean; iterations: number; stats: Record<string, Json> }
type DiagnosticObject = { [key: string]: unknown }

function jsonClone(value: unknown): Json {
  const encoded = JSON.stringify(value, (_key, item: unknown): unknown => item instanceof Map ? Object.fromEntries(item) : item)
  return encoded === undefined ? null : JSON.parse(encoded) as Json
}

function withoutNativeCounters(stats: Record<string, Json>): Record<string, Json> {
  return Object.fromEntries(Object.entries(stats).filter(([key]) => !key.startsWith("indexedDrc")))
}

// Read only the fields explicitly exposed by native debugState, avoiding the
// cyclic parent/cache references on TS solver instances. Missing optionals and
// null normalize together; Maps normalize to the same JSON object shape.
function correspondingState(binding: Json, reference: unknown): Json {
  if (binding === null || typeof binding !== "object" || Array.isArray(binding)) return jsonClone(reference)
  const source = (reference instanceof Map ? Object.fromEntries(reference) : reference) as DiagnosticObject | null | undefined
  return Object.fromEntries(Object.entries(binding).map(([key, value]) => [key, correspondingState(value, source?.[key])]))
}

const args = process.argv.slice(2)
const sharedDrcIndex = args.indexOf("--shared-drc")
const sharedDrc = sharedDrcIndex !== -1
if (sharedDrc) args.splice(sharedDrcIndex,1)
const outputIndex = args.indexOf("--out-dir")
const outputDirectory = outputIndex === -1 ? mkdtempSync(join(tmpdir(), "repair-loop-parity-")) : args[outputIndex + 1]
assert.ok(outputDirectory, "--out-dir requires a directory")
mkdirSync(outputDirectory, { recursive: true })
if (outputIndex !== -1) args.splice(outputIndex, 2)
const samples = (args.length === 0 ? ["8"] : args).flatMap((value) => value.split(",")).map(Number)
assert.ok(samples.every((sample) => Number.isInteger(sample) && sample > 0), "Samples must be positive integers")
await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
let sampleNumber = samples[0]!
let evaluations = 0
let steps = 0
let portfolios = 0
const allocated = new Set<bindings.GlobalDrcBranchPortfolioSolver>()

assert.equal(typeof registerRepairPortfolioBackend, "function", "Frozen reference checkout must retain its repair portfolio capture hook")
registerRepairPortfolioBackend((params, descriptor, referenceEvaluator) => {
  const { drcEvaluator, viaInPadDrcEvaluator, referenceDrcEvaluator, autoroutingDrcEngine, connMap, ...input } = params
  const prefix = `sample${sampleNumber}-portfolio${++portfolios}`
  writeFileSync(join(outputDirectory, `${prefix}-input.json`), JSON.stringify({ params: input, descriptor }))
  const callback = (routes: bindings.RepairRoutes): ReturnType<DrcEvaluator> => {
    return referenceEvaluator({ traces: [], routes, hdRoutes: routes })
  }
  let preparedEngine: AutoroutingDrcEngine | undefined
  let nativeDescriptor: bindings.RepairDescriptor = descriptor
  if (sharedDrc) {
    preparedEngine = new AutoroutingDrcEngine(descriptor.engineSrj,{...descriptor.engineOptions,connMap:params.connMap})
    const baseline = preparedEngine.evaluate(descriptor.originalTraces)
    const viaLocations = new Set<string>()
    const vias: AnyCircuitElement[] = []
    for (const trace of descriptor.originalTraces) for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const key = `${point.x},${point.y},${point.from_layer},${point.to_layer}`
      if (viaLocations.has(key)) continue
      viaLocations.add(key)
      vias.push({type:"pcb_via",pcb_via_id:`via_${vias.length}`,pcb_trace_id:trace.pcb_trace_id} as AnyCircuitElement)
    }
    const evaluatedTraceIds = new Set(descriptor.originalTraces.map(trace=>trace.pcb_trace_id))
    const errors = addAutoroutingViaTraceIds({errors:baseline.errors as unknown as Record<string,unknown>[],circuitJson:vias,evaluatedTraceIds})
    const errorsWithCenters = addAutoroutingViaTraceIds({errors:baseline.errorsWithCenters as unknown as Record<string,unknown>[],circuitJson:vias,evaluatedTraceIds})
    nativeDescriptor = {...descriptor,engineSrj:undefined,engineOptions:undefined,preparedBaseline:{errors,errorsWithCenters}}
  }
  const checker = new bindings.GlobalDrcBranchPortfolioSolver(input, nativeDescriptor, callback, preparedEngine?.forkForRepair())
  allocated.add(checker)
  const binding = new bindings.GlobalDrcBranchPortfolioSolver(input, nativeDescriptor, callback, preparedEngine?.forkForRepair())
  allocated.add(binding)
  const checkedEvaluator = (kind: string, evaluator: DrcEvaluator): DrcEvaluator => {
    const checked: DrcEvaluator = (arg) => {
      const expected = evaluator(arg)
      const routes = arg.routes ?? arg.hdRoutes
      const actual = checker.evaluateRoutes(routes!)
      evaluations++
      try {
        assert.deepStrictEqual(actual, jsonClone(expected))
      } catch (cause) {
        const path = join(outputDirectory, `${prefix}-evaluation-mismatch.json`)
        writeFileSync(path, JSON.stringify({ evaluation: evaluations, kind, routes, expected, actual }))
        throw new Error(`Evaluator mismatch ${evaluations}; details: ${path}`, { cause })
      }
      return expected
    }
    if (evaluator.evaluateLegacy) checked.evaluateLegacy = evaluator.evaluateLegacy.bind(evaluator)
    if (evaluator.getCachedResult) checked.getCachedResult = evaluator.getCachedResult.bind(evaluator)
    return checked
  }
  assert.ok(drcEvaluator, "Repair portfolio requires its indexed DRC evaluator")
  const ts = new GlobalDrcBranchPortfolioSolver({ ...params,
    drcEvaluator: checkedEvaluator("main", drcEvaluator),
    viaInPadDrcEvaluator: viaInPadDrcEvaluator ? checkedEvaluator("viaInPad", viaInPadDrcEvaluator) : undefined,
  })
  const originalStep = ts.step.bind(ts)
  ts.step = (): void => {
    originalStep()
    const actual = binding.step()
    steps++
    const expected = { solved: ts.solved, failed: ts.failed, iterations: ts.iterations, stats: jsonClone(ts.stats) }
    const state = { ...actual, stats: withoutNativeCounters(actual.stats) }
    const actualRoutes = binding.getOutput()
    const expectedRoutes = ts.getOutput()
    const diagnostic = binding.debugState()
    const expectedDiagnostic = correspondingState(diagnostic, ts as unknown as DiagnosticObject)
    try {
      assert.deepStrictEqual({ solved: state.solved, failed: state.failed, iterations: state.iterations, stats: state.stats }, expected)
      assert.deepStrictEqual(actualRoutes, jsonClone(expectedRoutes))
      assert.equal(JSON.stringify(actualRoutes), JSON.stringify(expectedRoutes), "Serialized route bytes differ")
      assert.deepStrictEqual(diagnostic, expectedDiagnostic, "Internal scheduler state differs")
    } catch (cause) {
      const path = join(outputDirectory, `${prefix}-step-mismatch.json`)
      writeFileSync(path, JSON.stringify({ step: steps, expected, actual: state, expectedRoutes, actualRoutes, expectedDiagnostic, diagnostic }))
      throw new Error(`Scheduler mismatch ${steps}; details: ${path}`, { cause })
    }
    if (steps % 20 === 0) console.log({ sampleNumber, steps, evaluations })
    if (ts.solved || ts.failed) {
      checker.free()
      binding.free()
      allocated.delete(checker)
      allocated.delete(binding)
      console.log("portfolio identical", { sampleNumber, steps, evaluations })
    }
  }
  return ts
})

try {
  for (sampleNumber of samples) {
    evaluations = 0
    steps = 0
    portfolios = 0
    const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber, 1)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1 })
    solver.solve()
    const result = { sampleNumber, solved: solver.solved, failed: solver.failed, error: solver.error,
      portfolios, steps, evaluations, traces: solver.solved ? solver.getOutputSimplifiedPcbTraces() : null }
    writeFileSync(join(outputDirectory, `sample${sampleNumber}-result.json`), JSON.stringify(result))
    console.log("board complete", { sampleNumber, solved: solver.solved, failed: solver.failed, error: solver.error, steps, evaluations })
  }
  console.log(`Parity artifacts: ${outputDirectory}`)
} finally {
  for (const binding of allocated) binding.free()
}
