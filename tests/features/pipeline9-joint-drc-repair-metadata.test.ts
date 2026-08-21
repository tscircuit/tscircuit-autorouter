import { expect, test } from "bun:test";
import type { AnyCircuitElement } from "circuit-json";
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalize-pipeline9-drc-errors-for-repair";
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepare-pipeline9-drc-routed-traces";
import type { SimplifiedPcbTrace } from "lib/types";

test("Pipeline9 joint DRC metadata keeps new route identities repairable", () => {
  const preloaded: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "fixed_connection",
    route: [],
  };
  const mutated = {
    ...preloaded,
    route: [
      { route_type: "wire" as const, x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  };
  const newTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "new_connection",
    route: [],
  };

  const routedTraces = preparePipeline9DrcRoutedTraces({
    originalPreloadedTraces: [preloaded],
    mutatedPreloadedTraces: [mutated],
    newTraces: [newTrace],
  });
  expect(routedTraces.map((trace) => trace.pcb_trace_id)).toEqual([
    "shared_trace_id_preloaded",
    "shared_trace_id",
  ]);
  expect(routedTraces[0]?.route).toEqual(mutated.route);

  const [tracePairError, viaError] = normalizePipeline9DrcErrorsForRepair({
    errors: [
      {
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_trace_error_id: "overlap_shared_trace_id_preloaded_shared_trace_id",
      },
      {
        pcb_trace_id: "shared_trace_id_preloaded",
        pcb_via_id: "new_via",
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
    ] as AnyCircuitElement[],
    newTraceIds: new Set(["shared_trace_id"]),
  });
  expect(tracePairError?.pcb_trace_id).toBe("shared_trace_id");
  expect(tracePairError?.pcb_trace_ids).toEqual([
    "shared_trace_id",
    "shared_trace_id_preloaded",
  ]);
  expect(viaError?.pcb_trace_id).toBe("shared_trace_id");
  expect(viaError?.pcb_via_ids).toEqual(["new_via"]);
});
