import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { importReference } from "./tsReference"

const { TraceSimplificationSolver: Reference } = await importReference<typeof import("../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver")>("lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts")

function run(Solver: typeof Reference, crossing: boolean, callbacks: boolean): unknown {
  const routes = [0, 1].map((y, index) => ({
    connectionName: index === 0 ? "a" : "b", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y, z: 0 }, { x: 0.5, y, z: 0 }, { x: 1, y, z: 0 }], vias: [],
  }))
  const solver = new Solver({ hdRoutes: routes, obstacles: [], connMap: new ConnectivityMap({ a: ["a"], b: ["b"] }), colorMap: {}, layerCount: 2, defaultViaDiameter: 0.3, enableCrossingViaReduction: crossing, enableVertexShortcuts: true })
  const retained = solver.hdRoutes
  const initial = { array: retained === routes, route: retained[0] === routes[0], point: retained[0]!.route[0] === routes[0]!.route[0] }
  routes[0]!.route[0]!.x = -10
  const steps: unknown[] = []
  const calls: unknown[] = []
  const seen = new Set<object>()
  while (!solver.solved && !solver.failed) {
    const child = solver.activeSubSolver
    if (callbacks && child && !seen.has(child)) {
      seen.add(child)
      const extract = solver.extractResult!
      solver.extractResult = current => {
        const output = extract(current)
        calls.push({ phase: solver.currentPhase, iterations: solver.iterations, sameChild: current === child, solved: current.solved, routes: JSON.stringify(output) })
        return output
      }
    }
    solver.step()
    steps.push({ iterations: solver.iterations, phase: solver.currentPhase, loops: solver.simplificationPipelineLoops, solved: solver.solved, failed: solver.failed, error: solver.error, child: solver.activeSubSolver?.getSolverName(), childIterations: solver.activeSubSolver?.iterations, extractor: typeof solver.extractResult, routes: JSON.stringify(solver.hdRoutes) })
    assert.ok(steps.length < 10000, "Trace simplification did not terminate")
  }
  const result = { initial, steps, calls, oldRoutes: retained, routes: solver.simplifiedHdRoutes, outputAlias: solver.simplifiedHdRoutes === solver.hdRoutes }
  if (solver instanceof TraceSimplificationSolver) solver.dispose()
  return result
}

for (const crossing of [false, true]) {
  for (const callbacks of [false, true]) {
    assert.deepEqual(run(TraceSimplificationSolver, crossing, callbacks), run(Reference, crossing, callbacks), `Trace orchestration crossing=${crossing}, callbacks=${callbacks}`)
  }
}
console.log("Trace phase lifecycle, custom extraction, copied inputs, retained output arrays and exact routes match")
