import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("path clearance covers nominal and retained-point copper widths unconditionally", (): void => {
  const pad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: ["foreign"],
  }
  for (const widths of [
    { nominal: 0.4, retained: undefined },
    { nominal: 0.1, retained: 0.5 },
  ]) {
    const inputRoute: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: widths.nominal,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.31, z: 0, traceThickness: widths.retained },
        { x: -1, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 1, y: 0.31, z: 0 },
      ],
      vias: [],
    }
    const original = structuredClone(inputRoute)
    const outputs: HighDensityRoute[] = []
    for (const compatibilityOption of [undefined, false, true]) {
      const solver = new SingleSimplifiedPathSolver5({
        inputRoute,
        otherHdRoutes: [],
        obstacles: [pad],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        useTraceWidthAwareClearance: compatibilityOption,
      })
      expect(solver.filteredObstacles).toHaveLength(1)
      expect(
        solver.isValidPathSegment(
          { x: -1, y: 0.31, z: 0 },
          { x: 1, y: 0.31, z: 0 },
        ),
      ).toBeFalse()
      expect(
        solver.isValidPathSegment(
          { x: -1, y: 0.8, z: 0 },
          { x: 1, y: 0.8, z: 0 },
        ),
      ).toBeTrue()
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      const output = solver.simplifiedRoute
      for (let index = 1; index < output.route.length; index++) {
        const start = output.route[index - 1]!
        const end = output.route[index]!
        expect(
          segmentToBoxMinDistance(start, end, pad) -
            (start.traceThickness ?? output.traceThickness) / 2,
        ).toBeGreaterThanOrEqual(0.1 - 1e-9)
      }
      outputs.push(output)
    }
    expect(outputs[1]).toEqual(outputs[0])
    expect(outputs[2]).toEqual(outputs[0])
    expect(inputRoute).toEqual(original)

    const outlineSolver = new SingleSimplifiedPathSolver5({
      inputRoute,
      otherHdRoutes: [],
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      minBoardEdgeClearance: 0.15,
      outline: [
        { x: -2, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    })
    expect(
      outlineSolver.isValidPathSegment(
        { x: -1, y: 0.31, z: 0 },
        { x: 1, y: 0.31, z: 0 },
      ),
    ).toBeFalse()
  }
})
