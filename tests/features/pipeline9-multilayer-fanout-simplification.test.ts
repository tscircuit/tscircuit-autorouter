import { expect, test } from "bun:test"
import type { PcbVia } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import input from "../fixtures/pipeline9-multilayer-fanout.json"

test("Pipeline9 retains multilayer fanout geometry while same-net shortcuts are limited to two layers", () => {
  const srj = structuredClone(input) as unknown as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  expect(
    output.traces!.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(6)
  const { circuitJson } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // Core emits through-hole vias on all four layers, even for a route that
  // changes between top and an inner layer. Check the actual copper span.
  const throughHoleCircuitJson = circuitJson.map((element) =>
    element.type === "pcb_via"
      ? {
          ...element,
          layers: ["top", "inner1", "inner2", "bottom"] as PcbVia["layers"],
        }
      : element,
  )
  expect(
    getDrcErrors(throughHoleCircuitJson, RELAXED_DRC_OPTIONS).errors,
  ).toHaveLength(0)
  expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
    import.meta.path,
  )
})
