import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { ConnectivityMap } from "../repro/node_modules/circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex, ObstacleSpatialHashIndex, SingleRouteUselessViaRemovalSolver } from "../repro/index"
import fixture from "../repro/tests/fixtures/gameboy-via-removal-platform.json"

type MathCall = { name: string; arguments: number[]; result: number; stack?: string }
const input = structuredClone(fixture)
const solver = new SingleRouteUselessViaRemovalSolver({
  ...input,
  obstacleSHI: new ObstacleSpatialHashIndex("flatbush", input.obstacles),
  hdRouteSHI: new HighDensityRouteSpatialIndex(input.indexedRoutes),
  connMap: new ConnectivityMap(input.connMap),
  terminalLayerIndicesByPcbPortId: new Map(input.terminalLayerIndicesByPcbPortId.map(([key, values]) => [key, new Set(values)])),
})
const calls: MathCall[] = []
const originalHypot = Math.hypot
const originalSqrt = Math.sqrt
Math.hypot = (...values: number[]): number => {
  const result = originalHypot(...values)
  calls.push({ name: "hypot", arguments: values, result, stack: new Error().stack })
  return result
}
Math.sqrt = (value: number): number => {
  const result = originalSqrt(value)
  calls.push({ name: "sqrt", arguments: [value], result, stack: new Error().stack })
  return result
}
try {
  solver.solve()
} finally {
  Math.hypot = originalHypot
  Math.sqrt = originalSqrt
}
if (solver.failed || !solver.solved) throw new Error(`Probe failed: ${solver.error}`)
const uninstrumented = await Bun.file("repro/tmp/gameboy-via-removal-routes.json").json()
if (JSON.stringify(uninstrumented) !== JSON.stringify(solver.getOptimizedHdRoute())) {
  throw new Error("Math observer changed the actual route")
}
writeFileSync("repro/tmp/math-calls.json.gz", gzipSync(JSON.stringify(calls)))
console.log("Native math observer preserved output; calls:", calls.length)
