import { expect, test } from "bun:test"
import { getPipeline9FixedRouteObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"

test.failing(
  "Pipeline9 keeps a preloaded top-to-inner2 via clear on bottom when blind vias are disabled",
  (): void => {
    const preloadedThroughVia: PreloadedHighDensityRoute = {
      connectionName: "preloaded-via",
      rootConnectionName: "preloaded-via",
      preloadedTraceIndex: 0,
      preloadedRouteIndex: 0,
      traceThickness: 0.15,
      viaDiameter: 0.45,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 2 },
      ],
      vias: [{ x: 0, y: 0 }],
    }

    const fixedObstacles = getPipeline9FixedRouteObstacles({
      fixedObstacleRoutes: [preloadedThroughVia],
      layerCount: 4,
    })

    // Blind and buried vias are disabled by default. The physical via must
    // therefore block all board copper layers, including bottom (z3).
    expect(fixedObstacles).toEqual([
      expect.objectContaining({
        center: { x: 0, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["top", "inner1", "inner2", "bottom"],
      }),
    ])
  },
)
