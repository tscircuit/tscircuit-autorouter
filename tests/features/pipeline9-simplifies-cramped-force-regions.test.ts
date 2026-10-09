import { expect, test } from "bun:test"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("cramped force regions remove redundant labeled grid points", () => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    rootConnectionName: "signal",
    regionId: "cramped-region",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 4_096 }, (_, pointIndex) => ({
      x: pointIndex / 4_095,
      y: 0,
      z: 0,
      connectionName: "signal",
      rootConnectionName: "signal",
    })),
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cramped-region",
    center: { x: 0.5, y: 0 },
    width: 1,
    height: 0.06,
    portPoints: [],
  }

  const [result] = simplifyPipeline9CollinearRoutePoints([route], [node])

  expect(result!.route.length).toBeLessThan(route.route.length)
  expect(result!.route[0]).toEqual(route.route[0])
  expect(result!.route.at(-1)).toEqual(route.route.at(-1))
  for (let pointIndex = 1; pointIndex < result!.route.length; pointIndex++) {
    const previous = result!.route[pointIndex - 1]!
    const point = result!.route[pointIndex]!
    expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(
      route.traceThickness * 1.2,
    )
  }
  expect(result!.vias).toEqual(route.vias)
})
