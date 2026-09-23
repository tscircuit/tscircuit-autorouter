import { expect, test } from "bun:test"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("collinear simplification keeps vias, reversals, layer transitions, and segment metadata", (): void => {
  const input: HighDensityRoute = {
    connectionName: "signal",
    regionId: "dense",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 1, y: 0 }],
    route: [
      ...Array.from({ length: 129 }, (_, index) => ({
        x: index / 128,
        y: 0,
        z: 0,
      })),
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
  const [result] = simplifyPipeline9CollinearRoutePoints([
    input,
    {
      ...input,
      connectionName: "dense_grid",
      vias: [],
      route: Array.from({ length: 4_096 }, (_, index) => ({
        x: index * 0.01,
        y: 10,
        z: 0,
      })),
    },
  ])
  expect(input).toEqual(original)
  expect(result!.route).toEqual([
    original.route[0],
    ...original.route.slice(128),
  ])
  expect(result!.vias).toEqual(original.vias)
})
