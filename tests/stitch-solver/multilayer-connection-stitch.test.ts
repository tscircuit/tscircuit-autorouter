import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import inputs from "./multilayer-connection-stitch.json"

/**
 * This test verifies the stitch solver correctly handles multi-layer connection points.
 *
 * source_net_1 has hdRoutes that are entirely on z:2 layer. The connection points
 * support multiple layers (top, inner1, inner2, bottom). The stitch solver should
 * recognize that the entire route can stay on z:2 and NOT add any vias.
 *
 * BUG: Currently the stitch solver places the start/end points on z:0 instead of z:2,
 * even though the route segments are on z:2 and the connection points support z:2.
 */
test("source_net_1 should have no vias when properly stitched on z:2 layer", () => {
  const solver = new MultipleHighDensityRouteStitchSolver(inputs[0] as any)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  // Find the merged route for source_net_1
  const sourceNet1Route = solver.mergedHdRoutes.find(
    (r) => r.connectionName === "source_net_1",
  )

  expect(sourceNet1Route).toBeDefined()

  // source_net_1 should have no vias because the route is entirely on z:2 layer
  expect(sourceNet1Route!.vias.length).toBe(0)

  // Verify all route points are on z:2 layer
  // The start and end points should match the layer of the adjacent route segments
  const firstPoint = sourceNet1Route!.route[0]
  const lastPoint = sourceNet1Route!.route[sourceNet1Route!.route.length - 1]

  // Start point at (-1.27, 3.81) should be on z:2 (same as the adjacent route segment)
  expect(firstPoint.z).toBe(2)

  // End point at (1.27, -1.27) should be on z:2 (same as the adjacent route segment)
  expect(lastPoint.z).toBe(2)
})

test("multilayer connection stitch solver visualization", async () => {
  const solver = new MultipleHighDensityRouteStitchSolver(inputs[0] as any)
  solver.solve()

  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
