import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { getMixedConnectionMinimumWidthNodeInput } from "../fixtures/getMixedConnectionMinimumWidthNodeInput"

test("traces sharing a detailed-routing node retain independent widths and clearance", (): void => {
  const solver = new Pipeline9HighDensitySolver(
    getMixedConnectionMinimumWidthNodeInput(),
  )
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const power = solver.routes.find((route) => route.connectionName === "POWER")!
  const signal = solver.routes.find(
    (route) => route.connectionName === "SIGNAL",
  )!
  expect(power.traceThickness).toBe(0.4)
  expect(signal.traceThickness).toBe(0.1)
  for (let i = 1; i < power.route.length; i++) {
    for (let j = 1; j < signal.route.length; j++) {
      expect(
        segmentToSegmentMinDistance(
          power.route[i - 1],
          power.route[i],
          signal.route[j - 1],
          signal.route[j],
        ),
      ).toBeGreaterThanOrEqual(0.35 - 1e-6)
    }
  }
})
