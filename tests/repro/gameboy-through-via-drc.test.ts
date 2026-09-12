import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import capturedPreFixTraces from "../../fixtures/bug-reports/gameboy-through-via-drc/gameboy-through-via-drc.pre-fix-traces.json" with {
  type: "json",
}
import capturedGameBoySrj from "../../fixtures/bug-reports/gameboy-through-via-drc/gameboy-through-via-drc.srj.json" with {
  type: "json",
}

const getCoreThroughViaDrcErrors = ({
  inputSrj,
  srjWithPointPairs,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
}) => {
  const throughViaLayers = Array.from({ length: inputSrj.layerCount }, (_, z) =>
    mapZToLayerName(z, inputSrj.layerCount),
  )
  const circuitJson = convertToCircuitJson(srjWithPointPairs, routedTraces, {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    includeOriginalConnections: true,
  }).map((element) =>
    element.type === "pcb_via"
      ? { ...element, layers: throughViaLayers }
      : element,
  ) as AnyCircuitElement[]
  circuitJson.push(
    createPcbBoardElement({
      ...inputSrj,
      minBoardEdgeClearance: inputSrj.minBoardEdgeClearance ?? 0,
    }),
  )
  return getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS).errors
}

test("Pipeline9 repairs the captured Game Boy's physical through-via DRCs", (): void => {
  // This is the 112-connection, four-layer Game Boy input captured from
  // gameboy-advance. Its published Pipeline9 result put a bottom trace
  // through two top-to-inner2 vias while blind/buried vias were disabled.
  const inputSrj = structuredClone(capturedGameBoySrj) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 1,
  })

  expect(inputSrj.connections).toHaveLength(112)
  expect(inputSrj.obstacles).toHaveLength(393)
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.allowBlindAndBuriedVias).toBeFalse()
  expect(inputSrj.traces ?? []).toHaveLength(0)

  solver.solve()

  expect(solver.srjWithPointPairs).toBeDefined()
  const capturedDrcErrors = getCoreThroughViaDrcErrors({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: capturedPreFixTraces as SimplifiedPcbTrace[],
  })
  expect(capturedDrcErrors.map((error) => error.type).sort()).toEqual([
    "pcb_trace_error",
    "pcb_trace_error",
    "pcb_via_trace_clearance_error",
  ])

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const repairedDrcErrors = getCoreThroughViaDrcErrors({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(repairedDrcErrors).toEqual([])
})
