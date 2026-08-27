import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { getCheckedViaInPadIdentities } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import srjJson from "../../fixtures/bug-reports/cm5-maker-carrier-drc/cm5-maker-carrier-drc.srj.json" with {
  type: "json",
}

const routedSrj = srjJson as SimpleRouteJson
const inputSrj: SimpleRouteJson = {
  ...structuredClone(routedSrj),
  allowViaInPad: false,
  traces: [],
}
const getErrorTypeCounts = (
  errors: Array<{ type: string }>,
): Record<string, number> =>
  Object.fromEntries(
    [...new Set(errors.map((error) => error.type))]
      .sort()
      .map((type) => [
        type,
        errors.filter((error) => error.type === type).length,
      ]),
  )

test("Pipeline 7 repairs CM5 carrier DRC violations at 1x effort", (): void => {
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.connections).toHaveLength(30)
  expect(inputSrj.obstacles).toHaveLength(318)
  expect(
    inputSrj.obstacles
      .filter((obstacle) => obstacle.obstacleRole === "pad")
      .map(
        (obstacle) =>
          obstacle.circuitJsonMetadata?.pcb_smtpad_id ??
          obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      )
      .sort(),
  ).toEqual([
    "pcb_smtpad_101",
    "pcb_smtpad_112",
    "pcb_smtpad_118",
    "pcb_smtpad_120",
  ])
  expect(routedSrj.traces).toHaveLength(141)
  expect(
    routedSrj.traces?.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(132)

  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(inputSrj),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const getReferenceDrc = (
    srjWithPointPairs: SimpleRouteJson,
    routedTraces: SimplifiedPcbTraces,
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      routedTraces,
      drcOptions: {
        supplementalConnMap: getConnectivityMapFromSimpleRouteJson({
          ...srjWithPointPairs,
          traces: routedTraces,
        }),
      },
    })
  const capturedDrc = getReferenceDrc(routedSrj, routedSrj.traces ?? [])
  const prePowerDrc = getReferenceDrc(
    solver.srjWithPointPairs!,
    solver.getPrePowerTraceOutputSimplifiedPcbTraces(),
  )
  const finalDrc = getReferenceDrc(
    solver.srjWithPointPairs!,
    solver.getOutputSimplifiedPcbTraces(),
  )

  expect(
    getCheckedViaInPadIdentities({
      circuitJson: capturedDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toHaveLength(3)
  expect(getErrorTypeCounts(capturedDrc.errors)).toEqual({
    pcb_pad_trace_clearance_error: 1,
    pcb_trace_error: 9,
    pcb_via_trace_clearance_error: 3,
  })
  expect(
    capturedDrc.errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id ===
          "overlap_source_net_10_mst1_0_source_trace_22_0",
    ),
  ).toBe(true)
  expect(
    capturedDrc.errors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id === "overlap_source_net_2_mst12_0_via_15",
    ),
  ).toBe(true)

  expect(prePowerDrc.errors.length).toBeGreaterThan(0)
  expect(finalDrc.errors).toHaveLength(0)
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: finalDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toHaveLength(0)
  expect(solver.postPowerDrcRepairSolver?.stats).toMatchObject({
    initialDrcErrorCount: 16,
    finalDrcErrorCount: 0,
    initialViaInPadCount: 3,
    finalViaInPadCount: 0,
    candidateBudgetExhausted: false,
    runtimeBudgetExhausted: false,
  })
})
