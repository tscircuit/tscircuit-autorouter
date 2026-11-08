import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { Pipeline9SameNetCopperGapSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9SameNetCopperGapSolver"
import { getSameNetCopperGapBridges } from "lib/utils/getSameNetCopperGapBridges"
import { getCopperLayerGraphics } from "tests/fixtures/getCopperLayerGraphics"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("native RVboy output closes same-net fabrication gaps without moving routed copper", async (): Promise<void> => {
  // Exact full native phase input, prepared netlist and emitted output. Only the
  // rendered viewport is cropped; repair and physical DRC use the whole board.
  const { inputSrj, prepared, traces } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-native-same-net-gaps.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    inputSrj: SimpleRouteJson
    prepared: SimpleRouteJson
    traces: SimplifiedPcbTrace[]
  }
  const original = JSON.stringify(traces)
  const oldIds = new Set(inputSrj.traces!.map((trace) => trace.pcb_trace_id))
  const evaluated = traces.map((trace) =>
    oldIds.has(trace.pcb_trace_id)
      ? { ...trace, __replaces_pcb_trace_id: trace.pcb_trace_id }
      : trace,
  )
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj,
    srjWithPointPairs: prepared,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.4 },
  })
  const before = evaluate(evaluated)
  expect(before.errors).toHaveLength(0)
  const solver = new Pipeline9SameNetCopperGapSolver({
    inputSrj,
    srjWithPointPairs: prepared,
    traces,
  })
  expect(() => solver.getOutput()).toThrow("before validation")
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.existingErrorCount).toBe(0)
  const bridges = solver.getOutput()
  expect(bridges).toHaveLength(3)
  expect(JSON.stringify(traces)).toBe(original)
  const after = evaluate([...evaluated, ...bridges])
  expect(after.errors).toHaveLength(0)
  expect(
    getSameNetCopperGapBridges({
      circuitJson: after.circuitJson,
      traces: [...traces, ...bridges],
      connMap: createDrcConnectivityMap(after.circuitJson),
      minimumClearance: 0.1,
      traceWidth: 0.1,
      validate: () => {
        throw new Error("Repair must be idempotent")
      },
    }),
  ).toHaveLength(0)
  for (const [state, added] of [
    ["before", []],
    ["after", bridges],
  ] as const) {
    const top = getCopperLayerGraphics(
      state === "before" ? before.circuitJson : after.circuitJson,
      "top",
    )
    await expect(
      renderRvboyRoutingView(
        top,
        { minX: 1.1, maxX: 4.15, minY: 2.35, maxY: 3.4 },
        "RVboy: close same-net copper gaps before fabrication",
        `${state}: ${added.length} validated bridges; original copper and 0.10 mm clearance preserved`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
