import { ConnectivityMap } from "../repro/node_modules/circuit-json-to-connectivity-map"
import type { HighDensityRoute, Obstacle } from "../repro/index"
import fixture from "../repro/tests/fixtures/gameboy-via-removal-platform.json"

type SolverModule = typeof import("../repro/index")
type Measurement = { milliseconds: number; points: number; vias: number }

const baseline: SolverModule = await import("../baseline/index")
const fix: SolverModule = await import("../repro/index")
const results: Record<string, Measurement[]> = { baseline: [], fix: [] }

function measure(module: SolverModule): Measurement {
  const input = structuredClone(fixture)
  const solver = new module.SingleRouteUselessViaRemovalSolver({
    ...input,
    obstacleSHI: new module.ObstacleSpatialHashIndex("flatbush", input.obstacles as Obstacle[]),
    hdRouteSHI: new module.HighDensityRouteSpatialIndex(input.indexedRoutes),
    connMap: new ConnectivityMap(input.connMap),
    terminalLayerIndicesByPcbPortId: new Map(
      (input.terminalLayerIndicesByPcbPortId as [string, number[]][]).map(([portId, layers]) => [portId, new Set(layers)]),
    ),
  })
  const start = performance.now()
  solver.solve()
  const milliseconds = performance.now() - start
  if (!solver.solved || solver.failed) throw new Error(`Solve failed: ${solver.error}`)
  const route: HighDensityRoute = solver.getOptimizedHdRoute()
  return { milliseconds, points: route.route.length, vias: route.vias.length }
}

for (let index = 0; index < 4; index++) {
  measure(baseline)
  measure(fix)
}
for (let index = 0; index < 20; index++) {
  const entries: [string, SolverModule][] = index % 2 === 0
    ? [["baseline", baseline], ["fix", fix]]
    : [["fix", fix], ["baseline", baseline]]
  for (const [name, module] of entries) results[name].push(measure(module))
}
console.log(JSON.stringify(results, null, 2))
await Bun.write("repro/tmp/timings.json", JSON.stringify(results, null, 2))
