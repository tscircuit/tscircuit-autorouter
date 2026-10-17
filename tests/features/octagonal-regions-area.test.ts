import { expect, test } from "bun:test"
import { computeOctagonalRegions } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/computeOctagonalRegions"
import { polyArea } from "pcb-poly-hyper-graph"

test("octagonal chamfers conserve exact area and honor explicit obstacle z layers", () => {
  const result = computeOctagonalRegions({
    layerCount: 2, minTraceWidth: 0.15, connections: [],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [{ type: "rect", center: { x: 5, y: 5 }, width: 2, height: 2,
      layers: ["top"], __zLayers: [1], connectedTo: ["pad"] }],
  }, 0.2)
  const removedArea = 2.4 ** 2 - 2 * ((2 - Math.SQRT2) * 0.2) ** 2
  expect(polyArea(result.obstacleRegions[0]!.polygon)).toBeCloseTo(removedArea, 8)
  for (const z of [0, 1]) {
    const area = result.regions.reduce((sum, polygon, i) =>
      sum + (result.availableZ[i]!.includes(z) ? polyArea(polygon) : 0), 0)
    expect(area).toBeCloseTo(z === 0 ? 100 : 100 - removedArea, 8)
  }
})
