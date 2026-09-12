import assert from "node:assert/strict"
import { setGlobalDrcForceImproveSolverVisualizer } from "high-density-repair03/lib"
import type { DrcEvaluator, GlobalDrcForceImproveSolverParams, HighDensityRoute } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { GlobalDrcForceImproveSolver as PublicSolver } from "../../../lib/index"
import { importReference } from "./tsReference"

const reference = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
assert.equal(PublicSolver, GlobalDrcForceImproveSolver)
type SolverView = Pick<GlobalDrcForceImproveSolver, "srj" | "inputHdRoutes" | "guardedInputHdRoutes" | "connMap" | "effort" | "outputHdRoutes" | "MAX_ITERATIONS" | "getConstructorParams" | "getOutput" | "solve" | "visualize" | "preview" | "iterations" | "solved" | "failed" | "stats">
type SolverConstructor = new (params: GlobalDrcForceImproveSolverParams) => SolverView

const template: GlobalDrcForceImproveSolverParams = {
  srj: { bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, connections: [{ name: "a", pointsToConnect: [] }], obstacles: [], layerCount: 2, minTraceWidth: 0.1 },
  hdRoutes: [{ connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }],
  enablePostSolveClearanceRelaxation: false,
}

function run(Solver: SolverConstructor): unknown {
  const params = structuredClone(template)
  const calls: unknown[] = []
  const evaluator: DrcEvaluator = (input) => {
    calls.push({ kind: "evaluate", sameSrj: input.srj === params.srj, sameInput: input.routes === params.hdRoutes })
    return []
  }
  const referenceEvaluator: DrcEvaluator = () => { throw new Error("Reference cache expected") }
  referenceEvaluator.getCachedResult = (input) => {
    calls.push({ kind: "reference", sameSrj: input.srj === params.srj, sameInput: input.routes === params.hdRoutes, traces: input.traces })
    return { errors: [] }
  }
  params.drcEvaluator = evaluator
  params.referenceDrcEvaluator = referenceEvaluator
  const solver = new Solver(params)
  assert.equal(calls.length, 1, "Reference cache runs during construction")
  assert.equal(solver.inputHdRoutes, params.hdRoutes)
  assert.equal(solver.outputHdRoutes, params.hdRoutes)
  assert.notEqual(solver.guardedInputHdRoutes, params.hdRoutes)
  assert.notEqual(solver.guardedInputHdRoutes[0], params.hdRoutes[0])
  assert.notEqual(solver.guardedInputHdRoutes[0]!.route[0], params.hdRoutes[0]!.route[0])
  const reconstructed = solver.getConstructorParams()[0]
  assert.equal(reconstructed.hdRoutes, params.hdRoutes)
  assert.equal(reconstructed.srj, params.srj)
  assert.equal(reconstructed.drcEvaluator, evaluator)
  assert.equal(reconstructed.referenceDrcEvaluator, referenceEvaluator)
  const constructorState = { keys: Object.keys(reconstructed), effort: solver.effort, max: solver.MAX_ITERATIONS, output: solver.getOutput(), guarded: solver.guardedInputHdRoutes }
  solver.solve()
  return { calls, constructorState, output: solver.getOutput(), iterations: solver.iterations, solved: solver.solved, failed: solver.failed, stats: solver.stats, graphics: solver.visualize(), preview: solver.preview() }
}

const visualizer = (solver: { getOutput(): HighDensityRoute[] }): { points: { x: number; y: number; label: string }[] } => ({ points: solver.getOutput().flatMap((route) => route.route.map((point) => ({ x: point.x, y: point.y, label: route.connectionName }))) })
reference.setGlobalDrcForceImproveSolverVisualizer(visualizer)
setGlobalDrcForceImproveSolverVisualizer(visualizer)
assert.deepEqual(run(GlobalDrcForceImproveSolver), run(reference.GlobalDrcForceImproveSolver))
for (const value of [0, -1, NaN, Infinity]) {
  const errors = [GlobalDrcForceImproveSolver, reference.GlobalDrcForceImproveSolver].map((Solver) => {
    let thrown: unknown
    try { new Solver({ ...structuredClone(template), viaHoleDiameter: value }) }
    catch (error) { thrown = error }
    assert.ok(thrown instanceof Error, "Expected constructor rejection")
    return { name: thrown.name, message: thrown.message }
  })
  assert.deepEqual(errors[0], errors[1])
}
console.log("Standalone repair constructor/reference timing, input aliases, parameters, native solve, dependency visualizer registry and invalid inputs match frozen TS")
