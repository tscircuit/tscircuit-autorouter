import { expect, test } from "bun:test"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("partitioning a foreign via does not remove it from path clearance checks", () => {
  const solver = new Pipeline9LayerPreservingPathSolver({
    obstacles: [],
    unsimplifiedHdRoutes: [
      {
        connectionName: "wire",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        vias: [],
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 0, y: 0.5, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
      {
        connectionName: "foreign-via",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        vias: [{ x: 0, y: 0 }],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const points = solver.simplifiedHdRoutes[0]!.route
  const via = { x: 0, y: 0 }
  for (let index = 1; index < points.length; index++) {
    expect(
      minimumDistanceBetweenSegments(
        points[index - 1]!,
        points[index]!,
        via,
        via,
      ),
    ).toBeGreaterThan(0.2)
  }
  expect(solver.simplifiedHdRoutes[1]!.vias).toEqual([via])
})
