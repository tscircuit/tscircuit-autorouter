import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("RVboy ground escape vias avoid preloaded power wires on every barrel layer", (): void => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-local-power-preloaded.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!pipeline.escapeViaLocationSolver?.solved && !pipeline.failed)
    pipeline.step()
  expect(pipeline.failed).toBe(false)
  const solver = pipeline.escapeViaLocationSolver!
  const via = solver.createdEscapeVias.find(
    (candidate) =>
      candidate.connectionName === "source_trace_30" &&
      candidate.sourcePointId === "pcb_port_34",
  )
  expect(via).toBeDefined()
  const power = input.traces!.find(
    (trace) =>
      trace.pcb_trace_id === "source_trace_122__source_trace_125_mst0_0",
  )!
  for (let index = 1; index < power.route.length; index++) {
    const a = power.route[index - 1]!,
      b = power.route[index]!
    if (
      a.route_type !== "wire" ||
      b.route_type !== "wire" ||
      a.layer !== b.layer
    )
      continue
    const gap =
      pointToSegmentDistance(via!, a, b) -
      Math.max(a.width, b.width) / 2 -
      solver.viaRadius
    expect(gap).toBeGreaterThanOrEqual(
      input.minViaEdgeToPadEdgeClearance! - 1e-4,
    )
  }
  // Existing trace copper stays a trace, not an obstacle in the topology graph.
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(input.traces)
  expect(
    solver
      .getOutputSimpleRouteJson()
      .obstacles.some((obstacle) =>
        obstacle.obstacleId?.startsWith("pipeline9_fixed_obstacle"),
      ),
  ).toBe(false)
})
