import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("the path pass honors requested pad clearance without changing trace or via rules", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0.35, z: 0 },
      { x: -1, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 0.35, z: 0 },
    ],
    vias: [],
  }
  const pad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["foreign"],
  }
  const originalRoute = structuredClone(inputRoute)
  for (const clearance of [undefined, 0.05, 0.2]) {
    const solver = new TraceSimplificationSolver({
      hdRoutes: [inputRoute],
      obstacles: [pad],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      minTraceToPadEdgeClearance: clearance,
      enableVertexShortcuts: true,
    })
    // Inspect the existing public path phase to verify both forwarding hops.
    solver.currentPhase = "path_simplification"
    solver.step()
    const multi = solver.activeSubSolver
    expect(multi).toBeInstanceOf(MultiSimplifiedPathSolver)
    if (!(multi instanceof MultiSimplifiedPathSolver)) {
      throw new Error("Expected the path-simplification phase")
    }
    multi.step()
    const single = multi.activeSubSolver
    expect(single).toBeInstanceOf(SingleSimplifiedPathSolver5)
    if (!(single instanceof SingleSimplifiedPathSolver5)) {
      throw new Error("Expected the individual path simplifier")
    }
    expect(
      single.isValidPathSegment(
        { x: -1, y: 0.35, z: 0 },
        { x: 1, y: 0.35, z: 0 },
      ),
    ).toBe(clearance !== 0.2)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const output = solver.simplifiedHdRoutes[0]!
    for (let index = 1; index < output.route.length; index++) {
      const start = output.route[index - 1]!
      const end = output.route[index]!
      expect(
        segmentToBoxMinDistance(start, end, pad) -
          inputRoute.traceThickness / 2,
      ).toBeGreaterThanOrEqual((clearance ?? 0.1) - 1e-9)
    }
  }
  expect(inputRoute).toEqual(originalRoute)
})
