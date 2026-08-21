import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  addAutoroutingViaTraceIds,
  remapDrcTraceIds,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-solver"
import { getPipeline9RegionalRepairTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-regional-b01-repairs"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalize-pipeline9-drc-errors-for-repair"
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepare-pipeline9-drc-routed-traces"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 joint DRC metadata keeps new route identities repairable", () => {
  const preloaded: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "fixed_connection",
    route: [],
  }
  const mutated = {
    ...preloaded,
    route: [
      { route_type: "wire" as const, x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const newTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "new_connection",
    route: [],
  }

  const routedTraces = preparePipeline9DrcRoutedTraces({
    originalPreloadedTraces: [preloaded],
    mutatedPreloadedTraces: [mutated],
    newTraces: [newTrace],
  })
  expect(routedTraces.map((trace) => trace.pcb_trace_id)).toEqual([
    "shared_trace_id_preloaded",
    "shared_trace_id",
  ])
  expect(routedTraces[0]?.route).toEqual(mutated.route)

  const [
    tracePairError,
    fixedTraceViaError,
    movableTraceViaError,
    typedMovableTraceViaError,
    physicalViaIdCollision,
    exactViaSuffixTracePair,
  ] = normalizePipeline9DrcErrorsForRepair({
    errors: [
      {
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_shared_trace_id",
      },
      {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_new_via",
        pcb_via_id: "new_via",
        pcb_via_ids: ["new_via"],
        pcb_trace_ids: ["shared_trace_id_preloaded", "shared_trace_id"],
      },
      {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "other_new_trace_id",
        pcb_trace_error_id: "overlap_other_new_trace_id_new_via",
        pcb_via_id: "new_via",
        pcb_via_ids: ["new_via"],
        pcb_trace_ids: ["other_new_trace_id", "shared_trace_id"],
      },
      {
        type: "pcb_via_trace_clearance_error",
        error_type: "pcb_via_trace_clearance_error",
        pcb_trace_id: "other_new_trace_id",
        pcb_via_trace_clearance_error_id:
          "via_trace_clearance_new_via_other_new_trace_id",
        pcb_via_id: "new_via",
      },
      {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_via_7",
        pcb_trace_ids: ["shared_trace_id_preloaded", "shared_trace_id"],
        pcb_via_id: "via_7",
        pcb_via_ids: ["via_7"],
      },
      {
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_via_7",
        pcb_trace_ids: ["shared_trace_id_preloaded", "via_7"],
      },
    ],
    circuitJson: [
      {
        type: "pcb_via",
        pcb_via_id: "new_via",
        pcb_trace_id: "shared_trace_id",
        x: 0,
        y: 0,
        outer_diameter: 0.3,
        hole_diameter: 0.2,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_via",
        pcb_via_id: "via_7",
        pcb_trace_id: "shared_trace_id",
        x: 1,
        y: 0,
        outer_diameter: 0.3,
        hole_diameter: 0.2,
        layers: ["top", "bottom"],
      },
    ] as AnyCircuitElement[],
    newTraceIds: new Set(["shared_trace_id", "other_new_trace_id", "via_7"]),
  })
  expect(tracePairError?.pcb_trace_id).toBe("shared_trace_id")
  expect(tracePairError?.pcb_trace_ids).toEqual([
    "shared_trace_id",
    "shared_trace_id_preloaded",
  ])
  expect(fixedTraceViaError?.pcb_trace_id).toBe("shared_trace_id")
  expect(fixedTraceViaError?.pcb_trace_ids).toEqual([
    "shared_trace_id",
    "shared_trace_id_preloaded",
  ])
  expect(fixedTraceViaError?.pcb_via_id).toBe("new_via")
  expect(fixedTraceViaError?.pcb_via_ids).toEqual(["new_via"])
  expect(movableTraceViaError?.pcb_trace_id).toBe("other_new_trace_id")
  expect(movableTraceViaError?.pcb_trace_ids).toEqual([
    "other_new_trace_id",
    "shared_trace_id",
  ])
  expect(movableTraceViaError?.pcb_via_ids).toEqual(["new_via"])
  expect(movableTraceViaError?.pcb_via_id).toBe("new_via")
  expect(typedMovableTraceViaError?.pcb_trace_id).toBe("other_new_trace_id")
  expect(typedMovableTraceViaError?.pcb_trace_ids).toEqual([
    "other_new_trace_id",
    "shared_trace_id",
  ])
  expect(typedMovableTraceViaError?.pcb_via_id).toBe("new_via")
  expect(typedMovableTraceViaError?.pcb_via_ids).toEqual(["new_via"])
  expect(physicalViaIdCollision?.pcb_trace_id).toBe("shared_trace_id")
  expect(physicalViaIdCollision?.pcb_trace_ids).toEqual([
    "shared_trace_id",
    "shared_trace_id_preloaded",
  ])
  expect(physicalViaIdCollision?.pcb_via_id).toBe("via_7")
  expect(exactViaSuffixTracePair).toMatchObject({
    pcb_trace_id: "via_7",
    pcb_trace_ids: ["via_7", "shared_trace_id_preloaded"],
    pcb_trace_error_id: "overlap_via_7_shared_trace_id_preloaded",
  })

  const regionalRouteIndexByTraceId = new Map([
    ["shared_trace_id_preloaded", 0],
    ["shared_trace_id", 1],
    ["via_7", 2],
  ])
  expect(
    getPipeline9RegionalRepairTraceIds({
      error: {
        type: "pcb_trace_error",
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_via_7",
        pcb_trace_ids: ["shared_trace_id_preloaded", "shared_trace_id"],
        pcb_via_id: "via_7",
        pcb_via_ids: ["via_7"],
      },
      routeIndexByTraceId: regionalRouteIndexByTraceId,
    }),
  ).toEqual(["shared_trace_id_preloaded", "shared_trace_id"])
  expect(
    getPipeline9RegionalRepairTraceIds({
      error: {
        type: "pcb_trace_error",
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_via_7",
        pcb_trace_ids: ["shared_trace_id_preloaded", "via_7"],
      },
      routeIndexByTraceId: regionalRouteIndexByTraceId,
    }),
  ).toEqual(["shared_trace_id_preloaded", "via_7"])

  const solverTraceIdByEvaluationTraceId = new Map([
    ["evaluation_primary", "solver_primary"],
    ["evaluation_section", "pipeline9_preloaded_drc_0_0"],
    ["evaluation_other_via_7", "solver_other"],
    ["via_7", "trace_id_collision_must_not_replace_via"],
  ])
  const [fixedPair, mappedPrimaryVia] = remapDrcTraceIds(
    [
      {
        pcb_trace_id: "fixed_trace",
        pcb_trace_ids: ["fixed_trace", "evaluation_section"],
        pcb_trace_error_id: "overlap_fixed_trace_evaluation_section",
      },
      {
        pcb_trace_id: "evaluation_primary",
        pcb_trace_ids: ["evaluation_primary", "fixed_trace"],
        pcb_trace_error_id: "overlap_evaluation_primary_via_7",
        pcb_via_id: "via_7",
        pcb_via_ids: ["via_7"],
      },
    ],
    solverTraceIdByEvaluationTraceId,
  )
  expect(fixedPair).toMatchObject({
    pcb_trace_id: "fixed_trace",
    pcb_trace_ids: ["fixed_trace", "pipeline9_preloaded_drc_0_0"],
    pcb_trace_error_id: "overlap_fixed_trace_pipeline9_preloaded_drc_0_0",
  })
  expect(mappedPrimaryVia).toMatchObject({
    pcb_trace_id: "solver_primary",
    pcb_trace_ids: ["solver_primary", "fixed_trace"],
    pcb_trace_error_id: "overlap_solver_primary_via_7",
    pcb_via_id: "via_7",
  })

  const [normalizedFixedPair] = normalizePipeline9DrcErrorsForRepair({
    errors: [fixedPair!],
    circuitJson: [],
    newTraceIds: new Set(["pipeline9_preloaded_drc_0_0"]),
  })
  expect(normalizedFixedPair).toMatchObject({
    pcb_trace_id: "pipeline9_preloaded_drc_0_0",
    pcb_trace_ids: ["pipeline9_preloaded_drc_0_0", "fixed_trace"],
    pcb_trace_error_id: "overlap_pipeline9_preloaded_drc_0_0_fixed_trace",
  })

  const [tracePairWithViaSuffix, encodedPhysicalVia, exactViaSuffixTrace] =
    addAutoroutingViaTraceIds({
      errors: [
        {
          pcb_trace_id: "evaluation_primary",
          pcb_trace_error_id:
            "overlap_evaluation_primary_evaluation_other_via_7",
        },
        {
          pcb_trace_id: "evaluation_primary",
          pcb_trace_error_id: "overlap_evaluation_primary_via_7",
          pcb_via_id: "via_7",
          pcb_via_ids: ["via_7"],
        },
        {
          pcb_trace_id: "evaluation_primary",
          pcb_trace_error_id: "overlap_evaluation_primary_via_7",
        },
      ],
      circuitJson: [
        {
          type: "pcb_via",
          pcb_via_id: "via_7",
          pcb_trace_id: "evaluation_section",
        } as AnyCircuitElement,
      ],
      evaluatedTraceIds: new Set([
        "evaluation_primary",
        "evaluation_other_via_7",
        "via_7",
      ]),
    })
  expect(tracePairWithViaSuffix?.pcb_via_id).toBeUndefined()
  expect(tracePairWithViaSuffix?.pcb_via_ids).toBeUndefined()
  expect(encodedPhysicalVia).toMatchObject({
    pcb_via_id: "via_7",
    pcb_via_ids: ["via_7"],
    pcb_trace_ids: ["evaluation_primary", "evaluation_section"],
  })
  expect(exactViaSuffixTrace?.pcb_via_id).toBeUndefined()
  expect(exactViaSuffixTrace?.pcb_via_ids).toBeUndefined()

  const [mappedTracePairWithViaSuffix, mappedEncodedPhysicalVia] =
    remapDrcTraceIds(
      [tracePairWithViaSuffix!, encodedPhysicalVia!],
      solverTraceIdByEvaluationTraceId,
    )
  expect(mappedTracePairWithViaSuffix?.pcb_trace_error_id).toBe(
    "overlap_solver_primary_solver_other",
  )
  expect(mappedEncodedPhysicalVia).toMatchObject({
    pcb_trace_id: "solver_primary",
    pcb_trace_ids: ["solver_primary", "pipeline9_preloaded_drc_0_0"],
    pcb_trace_error_id: "overlap_solver_primary_via_7",
    pcb_via_id: "via_7",
  })
})
