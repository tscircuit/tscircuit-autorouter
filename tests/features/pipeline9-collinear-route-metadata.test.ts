import { expect, test } from "bun:test"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("collinear simplification keeps vias, reversals, layer transitions, and segment metadata", (): void => {
  const input: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 1, y: 0 }],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0, pcb_port_id: "terminal" },
      { x: 3, y: 0, z: 0 },
      { x: 2.5, y: 0, z: 0 },
      { x: 2.5, y: 0, z: 1 },
      { x: 3, y: 0, z: 1, toNextSegmentType: "through_obstacle" },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 0, z: 1 },
      { x: 5, y: 1, z: 1 },
    ],
  }
  const original = structuredClone(input)
  const [result] = simplifyPipeline9CollinearRoutePoints([input])
  expect(input).toEqual(original)
  expect(result!.route).toEqual(original.route.filter((_, i) => i !== 1))
  expect(result!.vias).toEqual(original.vias)
})
