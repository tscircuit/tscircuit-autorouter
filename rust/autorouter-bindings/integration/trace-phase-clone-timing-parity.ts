import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, Jumper } from "../../../lib/types/high-density-types"
import { TraceSimplificationSolver } from "../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { importReference } from "./tsReference"

const { TraceSimplificationSolver: Reference } = await importReference<typeof import("../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver")>("lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts")

function run(Solver: typeof Reference, phase: "via_merging" | "crossing_via_reduction"): unknown {
  const shared = { x: 0, y: 0 }
  const jumpers: Jumper[] = [
    { route_type: "jumper", start: shared, end: { x: 1, y: 0 }, footprint: "0603" },
    { route_type: "jumper", start: shared, end: { x: 2, y: 0 }, footprint: "0603" },
  ]
  const routes: HighDensityRoute[] = [{ connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [], jumpers }]
  const solver = new Solver({ hdRoutes: routes, obstacles: [], connMap: new ConnectivityMap({ a: ["a"] }), colorMap: {}, layerCount: 2, defaultViaDiameter: 0.3, enableCrossingViaReduction: true })
  solver.currentPhase = phase
  solver.step()
  jumpers[0]!.start = { x: 9, y: 9 }
  shared.y = 0.4
  const child = solver.activeSubSolver!
  const output = phase === "via_merging"
    ? (child as any).mergedViaHdRoutes as HighDensityRoute[]
    : (child as any).reducedHdRoutes as HighDensityRoute[]
  const result = {
    output,
    input: routes,
    sharedStarts: output[0]!.jumpers![0]!.start === output[0]!.jumpers![1]!.start,
    detachedStart: output[0]!.jumpers![1]!.start !== shared,
  }
  if (solver instanceof TraceSimplificationSolver) solver.dispose()
  return result
}

for (const phase of ["via_merging", "crossing_via_reduction"] as const) assert.deepEqual(run(TraceSimplificationSolver, phase), run(Reference, phase), phase)
console.log("Native phase constructors preserve deep-clone timing and shared nested jumper references")
