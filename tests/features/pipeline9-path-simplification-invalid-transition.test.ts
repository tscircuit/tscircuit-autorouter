import { expect, test } from "bun:test"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"

test("path simplification rejects a displaced layer transition rather than guessing a via", () => {
  expect(
    () =>
      new Pipeline9LayerPreservingPathSolver({
        unsimplifiedHdRoutes: [
          {
            connectionName: "invalid-layer-change",
            traceThickness: 0.1,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: 0, z: 0 },
              { x: 0.2, y: 0, z: 1 },
            ],
            vias: [],
          },
        ],
        obstacles: [],
      }),
  ).toThrow("changes layers from z=0 to z=1 without an explicit via")
  expect(
    () =>
      new Pipeline9LayerPreservingPathSolver({
        unsimplifiedHdRoutes: [
          {
            connectionName: "ambiguous-layer-change",
            traceThickness: 0.1,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: 0, z: 0 },
              { x: 0.2, y: 0, z: 1 },
            ],
            vias: [
              { x: 0, y: 0 },
              { x: 0.2, y: 0 },
            ],
          },
        ],
        obstacles: [],
      }),
  ).toThrow("has an ambiguous layer transition")
})
