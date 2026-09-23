import { expect, test } from "bun:test"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("ordinary force regions retain their control vertices even on a large board", (): void => {
  const routes: HighDensityRoute[] = Array.from({ length: 16 }, (_, index) => ({
    connectionName: `signal_${index}`,
    regionId: `region_${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 512 }, (_, pointIndex) => ({
      x: pointIndex * 0.01,
      y: index,
      z: 0,
    })),
  }))
  expect(simplifyPipeline9CollinearRoutePoints(routes)).toEqual(routes)
})
