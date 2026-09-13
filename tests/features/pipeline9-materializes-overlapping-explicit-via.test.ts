import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 materializes an explicit via whose pad overlaps a transition endpoint", () => {
  const via = { x: 28.71487812381829, y: -8.275462905517898 }
  const hdRoute: HighDensityRoute = {
    connectionName: "breakout-net:pcb_group_3:source_net_15_fixed_140_8",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    route: [
      { x: 28.607450018614553, y: -7.931889673201436, z: 0 },
      { x: 28.607450018614553, y: -8.138786224925575, z: 1 },
    ],
    vias: [via],
  }

  const materialized = materializePipeline9HdRouteVias([hdRoute])[0]!

  expect(materialized.route).toEqual([
    hdRoute.route[0],
    { ...via, z: 0 },
    { ...via, z: 1 },
    hdRoute.route[1],
  ])
  expect(getPipeline9RouteCopperGeometry(materialized)).toMatchObject({
    viaSpans: [
      {
        center: via,
        minZ: 0,
        maxZ: 1,
        diameter: 0.45,
      },
    ],
  })
})
