import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared conversion preserves declared and overridden via dimensions, physical layers and signed endpoint coordinates", (): void => {
  for (const originalBlind of [false, true]) {
    for (const overrideDiameter of [undefined, 0.81]) {
      for (const overrideHole of [undefined, 0.23]) {
        const { srj, originalSrj, traces } = createPreparedRepairCircuitInput(1)
        srj.min_via_pad_diameter = 0.72
        srj.min_via_hole_diameter = 0.29
        srj.allowBlindAndBuriedVias = !originalBlind
        originalSrj.allowBlindAndBuriedVias = originalBlind
        const candidate = structuredClone(traces)
        for (const trace of candidate) {
          for (const segment of trace.route) {
            if (segment.route_type === "via") {
              delete segment.via_diameter
              delete segment.via_hole_diameter
              segment.layers = ["top", "inner1"]
            }
          }
        }
        const first = candidate[0]!.route[0]!
        if ("x" in first) first.x = -0
        const options = {
          originalSrj,
          includeOriginalConnections: true,
          ...(overrideDiameter === undefined ? {} : { minViaDiameter: overrideDiameter }),
          ...(overrideHole === undefined ? {} : { minViaHoleDiameter: overrideHole }),
        }
        const prepared = createPreparedRepairCircuitJsonConverter(srj, options, createPreparedRepairCircuitStats())
        expect(prepared(candidate)).toEqual(convertToCircuitJson(srj, candidate, options))
        if ("x" in first) first.x = 0
        expect(prepared(candidate)).toEqual(convertToCircuitJson(srj, candidate, options))
      }
    }
  }
})
