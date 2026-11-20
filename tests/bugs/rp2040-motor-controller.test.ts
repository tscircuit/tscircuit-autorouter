import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/rp2040-motor-controller/rp2040-motor-controller.srj.json" with {
  type: "json",
}

// Captured from imrishabh18/rp2040-motor-controller v1.0.58 with saved routes removed.
test("RP2040 motor controller: default Pipeline 9 relaxed DRC", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
  expect(
    evaluateRelaxedDrc({
      ...drcInput,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: input.minTraceToPadEdgeClearance,
        viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
      },
    }).errors,
  ).toEqual([])
  const vmHfTrace = routedTraces.find(
    (trace) =>
      trace.connectsTo?.includes("pcb_port_253") &&
      trace.connectsTo.includes("pcb_port_261"),
  )
  expect(vmHfTrace?.nominalTraceWidth).toBe(0.8)
  const vmHfWireWidths = vmHfTrace?.route.flatMap((point, index) => {
    const end = vmHfTrace.route[index + 1]
    if (
      point.route_type === "wire" &&
      end?.route_type === "wire" &&
      point.layer === end.layer &&
      (point.x !== end.x || point.y !== end.y)
    ) {
      return [point.width]
    }
    return []
  })
  // Native routing can produce different route variants across platforms.
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(snapshotPath)
  expect(vmHfWireWidths).toContain(0.8)
})
