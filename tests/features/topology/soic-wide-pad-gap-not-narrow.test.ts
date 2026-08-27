import { expect, test } from "bun:test"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("SOIC narrow-gap detection measures the inter-pad axis", () => {
  const rowYValues = [-3, -1, 1, 3]
  const obstacles: Obstacle[] = [-1, 1].flatMap((x, sideIndex) =>
    rowYValues.map((y, rowIndex) => ({
      type: "rect" as const,
      obstacleId: `pad_${sideIndex}_${rowIndex}`,
      componentId: "wide_pitch_soic",
      connectedTo: [`port_${sideIndex}_${rowIndex}`],
      layers: ["top"],
      __zLayers: [0],
      center: { x, y },
      width: 0.18,
      height: 0.2,
    })),
  )
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -4, maxY: 4 },
    obstacles,
    connections: [],
  }
  const detectedComponent: DetectedComponent = {
    componentId: "wide_pitch_soic",
    componentKind: "soic",
    bounds: {
      __type: "rect",
      minX: -1.09,
      maxX: 1.09,
      minY: -3.1,
      maxY: 3.1,
    },
  }
  const solver = new SoicTopologyGeneratorSolver({
    inputSrj,
    detectedComponent,
  })

  solver.solve()

  const routingRegions = solver.getOutput().routingRegions
  const padNodes = routingRegions.filter(
    (node) => node._soicRegionType === "pad",
  )
  expect(solver.failed).toBe(false)
  expect(routingRegions.some((node) => node._isNarrowSoicPadGap)).toBe(false)
  expect(
    padNodes.every((node) => node._soicPadOutwardDirection === undefined),
  ).toBe(true)
})
