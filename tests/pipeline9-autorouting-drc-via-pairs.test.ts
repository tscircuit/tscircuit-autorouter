import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/create-pipeline9-autorouting-drc-evaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 native DRC preserves via pair identities, dimensions, and net relations", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      { name: "a", pointsToConnect: [] },
      { name: "b", pointsToConnect: [] },
    ],
  }
  const traceA: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace_a",
    connection_name: "a",
    route: [{
      route_type: "via",
      x: 0,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.5,
      via_hole_diameter: 0.25,
    }],
  }
  const traceB: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace_b",
    connection_name: "b",
    route: [{
      route_type: "via",
      x: 0.25,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    }],
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  for (const connectionName of ["b", "a", "b"]) {
    const traces = [traceA, { ...traceB, connection_name: connectionName }]
    const reference = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: traces,
    })
    const result = evaluate(traces)
    expect(reference.errors).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({
      type: "pcb_via_clearance_error",
      pcb_via_ids: ["via_0", "via_1"],
      pcb_error_id: `${connectionName === "a" ? "same_net" : "different_net"}_vias_close_via_0_via_1`,
      center: { x: 0.125, y: 0 },
    })
    expect(result.errors[0]?.pcb_error_id).toBe(
      (reference.errors[0] as unknown as Record<string, unknown>).pcb_error_id,
    )
    expect(result.errorsWithCenters[0]?.center).toEqual(
      reference.errorsWithCenters[0]?.center,
    )
    expect(result.errors[0]?.actual_clearance).toBeCloseTo(0.05)
    expect(result.errorsWithCenters as unknown[]).toEqual(
      reference.errorsWithCenters as unknown[],
    )
  }

  const separated = [traceA, {
    ...traceB,
    route: traceB.route.map((point) => ({ ...point, x: 0.45 })),
  }]
  expect(evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: separated,
  }).errors).toHaveLength(0)
  expect(evaluate(separated).errors).toHaveLength(0)

  for (const x of [0.2, 0.004, 0.006]) {
    const defaultHoleTraces = [
      {
        ...traceA,
        route: traceA.route.map((point) => ({
          ...point,
          via_hole_diameter: undefined,
        })),
      },
      {
        ...traceB,
        route: traceB.route.map((point) => ({
          ...point,
          x,
          via_hole_diameter: undefined,
        })),
      },
    ]
    const reference = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: defaultHoleTraces,
    })
    expect(reference.errors).toHaveLength(x === 0.004 ? 0 : 1)
    expect(evaluate(defaultHoleTraces).errorsWithCenters as unknown[]).toEqual(
      reference.errorsWithCenters as unknown[],
    )
  }

  const clusteredTraces: SimplifiedPcbTrace[] = Array.from(
    { length: 12 },
    (_, index) => ({
      ...traceB,
      pcb_trace_id: `cluster_trace_${index}`,
      connection_name: index % 3 === 0 ? "a" : "b",
      route: traceB.route.map((point) => ({ ...point, x: index * 0.02 })),
    }),
  )
  const clusteredReference = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: clusteredTraces,
  })
  expect(clusteredReference.errors.length).toBeGreaterThan(2)
  expect(evaluate(clusteredTraces).errorsWithCenters as unknown[]).toEqual(
    clusteredReference.errorsWithCenters as unknown[],
  )
})
