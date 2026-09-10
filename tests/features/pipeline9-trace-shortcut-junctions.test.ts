import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyPipeline9TraceShortcuts } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9TraceShortcuts"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("post-repair shortcuts preserve endpoint branches and crossing copper contacts", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 2, y: 0, z: 0 }],
  }
  for (const branchPoints of [
    [{ x: 1, y: 2, z: 0 }, { x: 1, y: 3, z: 0 }],
    [{ x: 1, y: 1, z: 0 }, { x: 1, y: 3, z: 0 }],
  ]) {
    const branch: HighDensityRoute = { ...route, connectionName: "branch", route: branchPoints }
    const shortened = applyPipeline9TraceShortcuts({
      routes: [route], otherHdRoutes: [branch], colorMap: {},
      connMap: new ConnectivityMap({ signalNet: ["signal", "branch"] }),
      srj: { layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [], bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } },
      drcEvaluator: () => [],
    })
    expect(shortened).toEqual([route])
  }
})
