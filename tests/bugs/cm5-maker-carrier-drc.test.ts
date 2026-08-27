import { checkViasInPads } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import srjJson from "../../fixtures/bug-reports/cm5-maker-carrier-drc/cm5-maker-carrier-drc.srj.json" with {
  type: "json",
}

const routedSrj = srjJson as SimpleRouteJson
const inputSrj: SimpleRouteJson = {
  ...structuredClone(routedSrj),
  allowViaInPad: false,
  traces: [],
}
const conversionAliasArtifactIds = new Set([
  "overlap_source_net_12_0_pcb_plated_hole_7",
  "overlap_source_net_13_0_pcb_plated_hole_11",
  "overlap_source_trace_14_0_source_trace_10__source_trace_12_mst1_0",
])

const getErrorTypeCounts = (errors: Array<{ type: string }>) =>
  Object.fromEntries(
    [...new Set(errors.map((error) => error.type))]
      .sort()
      .map((type) => [
        type,
        errors.filter((error) => error.type === type).length,
      ]),
  )

const getActualViaInPadErrors = (
  circuitJson: Parameters<typeof checkViasInPads>[0],
) =>
  checkViasInPads(circuitJson).filter((error) =>
    /^via_in_pad_via_\d+_pcb_smtpad_\d+$/.test(error.pcb_placement_error_id),
  )

const getDrcErrorId = (error: Record<string, unknown>) =>
  [
    error.pcb_trace_error_id,
    error.pcb_via_trace_clearance_error_id,
    error.pcb_pad_trace_clearance_error_id,
  ].find((value): value is string => typeof value === "string")

test("Pipeline 7 records CM5 carrier DRC violations at 1x effort", () => {
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.connections).toHaveLength(30)
  expect(inputSrj.obstacles).toHaveLength(318)
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
  ) =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      routedTraces,
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

  expect(getActualViaInPadErrors(capturedDrc.circuitJson)).toHaveLength(3)
  expect(getErrorTypeCounts(capturedDrc.errors)).toEqual({
    pcb_pad_trace_clearance_error: 1,
    pcb_trace_error: 11,
    pcb_via_trace_clearance_error: 3,
  })
  const legitimateCapturedErrors = capturedDrc.errors.filter(
    (error) =>
      !conversionAliasArtifactIds.has(
        getDrcErrorId(error as unknown as Record<string, unknown>) ?? "",
      ),
  )
  expect(getErrorTypeCounts(legitimateCapturedErrors)).toEqual({
    pcb_pad_trace_clearance_error: 1,
    pcb_trace_error: 8,
    pcb_via_trace_clearance_error: 3,
  })
  expect(
    legitimateCapturedErrors.some(
      (error) =>
        error.type === "pcb_trace_error" &&
        error.pcb_trace_error_id ===
          "overlap_source_net_10_mst1_0_source_trace_22_0",
    ),
  ).toBe(true)

  const legitimateFinalErrors = finalDrc.errors.filter(
    (error) =>
      !conversionAliasArtifactIds.has(
        getDrcErrorId(error as unknown as Record<string, unknown>) ?? "",
      ),
  )
  expect(prePowerDrc.errors.length).toBeGreaterThan(0)
  expect(legitimateFinalErrors.length).toBeGreaterThan(0)
  expect(getActualViaInPadErrors(finalDrc.circuitJson).length).toBeGreaterThan(
    0,
  )
})
