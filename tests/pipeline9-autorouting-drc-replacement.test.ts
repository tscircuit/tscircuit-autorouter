import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { preparePipeline9DrcRoutedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9DrcRoutedTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 native DRC preserves colliding preloaded ids and replaces only marked copper", () => {
  const preloaded: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "fixed",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const newTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "new",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [
      {
        name: "fixed",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_fixed_start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_fixed_end" },
        ],
      },
      {
        name: "new",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pcb_port_id: "pcb_port_new_start" },
          { x: 0, y: 1, layer: "top", pcb_port_id: "pcb_port_new_end" },
        ],
      },
    ],
    traces: [preloaded],
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const collidingTraces = preparePipeline9DrcRoutedTraces({
    originalPreloadedTraces: [preloaded],
    mutatedPreloadedTraces: [],
    newTraces: [newTrace],
  })
  const reference = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: collidingTraces,
  })
  const collision = evaluate(collidingTraces)
  expect(reference.errors).toHaveLength(1)
  expect(collision.errors).toHaveLength(1)
  expect(collision.errors[0]).toMatchObject({
    type: "pcb_trace_error",
    pcb_trace_id: "shared_trace_id_preloaded",
    pcb_trace_error_id: "overlap_shared_trace_id_preloaded_shared_trace_id",
    center: { x: 0, y: 0 },
  })
  expect(collision.errors[0]?.pcb_trace_error_id).toBe(
    (reference.errors[0] as unknown as Record<string, unknown>)
      .pcb_trace_error_id,
  )
  expect(collision.errorsWithCenters[0]?.center).toEqual(
    reference.errorsWithCenters[0]?.center,
  )
  expect(collision.errorsWithCenters as unknown[]).toEqual(
    reference.errorsWithCenters as unknown[],
  )

  const movedPreloaded: SimplifiedPcbTrace = {
    ...preloaded,
    route: [
      preloaded.route[0]!,
      { route_type: "wire", x: -1, y: 2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 2, width: 0.1, layer: "top" },
      preloaded.route[1]!,
    ],
  }
  const replacedTraces = preparePipeline9DrcRoutedTraces({
    originalPreloadedTraces: [preloaded],
    mutatedPreloadedTraces: [movedPreloaded],
    newTraces: [newTrace],
  })
  const repaired = evaluate(replacedTraces)
  expect(
    repaired.circuitJson.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(2)
  expect(repaired.errors).toHaveLength(0)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: replacedTraces,
    }).errors,
  ).toHaveLength(0)
  expect(evaluate(collidingTraces).errors).toEqual(collision.errors)
})
