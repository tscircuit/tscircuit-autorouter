import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { canPublishPartialFixedObstacleRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishPartialFixedObstacleRepair"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

test("Pipeline9 preserves the net 2 via clearance repair on SRJ23 sample 57 when unchanged input connectivity errors remain", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 57)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const baselineMissingIds = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
  })
    .errors.flatMap((error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_id === "source_net_0_mst0_0" &&
      typeof error.pcb_trace_error_id === "string"
        ? [error.pcb_trace_error_id]
        : [],
    )
    .sort()

  expect(baselineMissingIds).toEqual([
    "missing_connection_source_net_0_mst0_0_pcb_port_1",
    "missing_connection_source_net_0_mst0_0_pcb_port_37",
    "missing_connection_source_net_0_mst0_0_pcb_port_42",
  ])

  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  const viaTraceErrors = errors.filter(
    (error) => error.type === "pcb_via_trace_clearance_error",
  )
  expect(viaTraceErrors).toHaveLength(0)
  expect(errors).toHaveLength(3)
  expect(
    errors
      .map((error) =>
        error.type === "pcb_trace_error"
          ? (error.pcb_trace_error_id ?? error.type)
          : error.type,
      )
      .sort(),
  ).toEqual(baselineMissingIds)
}, 120_000)

test("partial publication allows unchanged stage-input connectivity errors matched at most once while rejecting new, altered or moving-copper errors", (): void => {
  const originalSrj = fixture.srj as SimpleRouteJson
  const missingConnectionError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    source_trace_id: "source_net_0",
    pcb_trace_id: "source_net_0_mst0_0",
    pcb_trace_error_id: "missing_connection_source_net_0_mst0_0_pcb_port_1",
    message:
      "Trace [unnamed trace] is missing a connection to SMD pad unnamed port",
    center: { x: -12.15, y: 0.365 },
    pcb_component_ids: [],
    pcb_port_ids: ["pcb_port_1"],
  }
  const disconnectedEndpointError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    source_trace_id: "!raw_trace_0",
    pcb_trace_id: "raw_trace_0",
    pcb_trace_error_id: "disconnected_endpoint_raw_trace_0_end",
    message: "Trace [raw_trace_0] has disconnected endpoint at (1.00, 2.00)",
    center: { x: 1, y: 2 },
    pcb_component_ids: [],
    pcb_port_ids: [],
  }
  const clearedViaTraceError: Pipeline9DrcError = {
    type: "pcb_via_trace_clearance_error",
    pcb_via_trace_clearance_error_id:
      "via_trace_clearance_via_17_source_net_4_mst0_0",
    pcb_via_id: "via_17",
    pcb_trace_id: "source_net_4_mst0_0",
    minimum_clearance: 0.1,
    actual_clearance: 0.083,
  }
  const fixedPadClearanceError: Pipeline9DrcError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "signal_0",
    pcb_pad_id: "pcb_smtpad_62",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }

  expect(
    canPublishPartialFixedObstacleRepair({
      originalSrj,
      initialErrors: [
        missingConnectionError,
        fixedPadClearanceError,
        clearedViaTraceError,
      ],
      remainingErrors: [
        { ...missingConnectionError, center: { x: -12.15, y: 0.365 } },
        { ...fixedPadClearanceError, actual_clearance: 0.07 },
      ],
    }),
  ).toBeTrue()

  // Matching each stage-input error at most once rejects duplicates.
  expect(
    canPublishPartialFixedObstacleRepair({
      originalSrj,
      initialErrors: [
        missingConnectionError,
        fixedPadClearanceError,
        clearedViaTraceError,
      ],
      remainingErrors: [missingConnectionError, missingConnectionError],
    }),
  ).toBeFalse()

  // Altered center, different port, or non-finite numbers must block publication.
  for (const mutated of [
    { ...missingConnectionError, center: { x: -12.1, y: 0.365 } },
    {
      ...missingConnectionError,
      pcb_trace_error_id: "missing_connection_source_net_0_mst0_0_pcb_port_37",
      pcb_port_ids: ["pcb_port_37"],
    },
    { ...missingConnectionError, center: { x: Number.NaN, y: 0.365 } },
  ]) {
    expect(
      canPublishPartialFixedObstacleRepair({
        originalSrj,
        initialErrors: [missingConnectionError, clearedViaTraceError],
        remainingErrors: [mutated],
      }),
    ).toBeFalse()
  }

  // Portless disconnected-endpoint, moving-copper, and board-edge errors still require clean/independent repair.
  const movingTraceOverlap: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_a",
    pcb_trace_error_id: "overlap_trace_a_trace_b",
    pcb_port_ids: ["pcb_port_1"],
  }
  const boardEdgeError: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_id: "trace_a",
    pcb_trace_error_id: "trace_too_close_to_board_trace_a_segment_0",
    pcb_port_ids: [],
  }
  for (const disallowed of [
    disconnectedEndpointError,
    clearedViaTraceError,
    movingTraceOverlap,
    boardEdgeError,
  ]) {
    expect(
      canPublishPartialFixedObstacleRepair({
        originalSrj,
        initialErrors: [disallowed, fixedPadClearanceError],
        remainingErrors: [disallowed],
      }),
    ).toBeFalse()
  }
})
