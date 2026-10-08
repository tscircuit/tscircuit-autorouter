import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

test("Pipeline9 releases unused pre-high-density state", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -4, layer: "top" },
          { x: 0, y: 4, layer: "top" },
        ],
      },
    ],
  })

  solver.solveUntilPhase("portPointPathingSolver")
  solver.step()

  expect(solver.portPointPathingSolver).toBeDefined()
  expect(solver.preprocessSimpleRouteJsonSolver).toBeUndefined()
  expect(solver.escapeViaLocationSolver).toBeUndefined()
  expect(solver.componentDetectionSolver).toBeUndefined()
  expect(solver.componentTopologyGeneratorSolver).toBeUndefined()
  expect(solver.globalTopologyGeneratorSolver).toBeUndefined()
  expect(solver.topologyPlanningSolver).toBeUndefined()
  expect(solver.topologyMergingSolver).toBeUndefined()
  expect(solver.nodeDimensionSubdivisionSolver).toBeUndefined()
  expect(solver.edgeSolver).toBeUndefined()
  expect(solver.availableSegmentPointSolver).toBeUndefined()
  expect(solver.necessaryCrampedPortPointSolver).toBeUndefined()
  expect(solver.preloadedTraceGraphSolver).toBeUndefined()
  expect(solver.capacityNodes).toBeNull()
  expect(solver.capacityEdges).toBeNull()
  expect(
    solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints,
  ).toBeUndefined()
  expect(solver.srjWithEscapeViaLocations).toBeUndefined()

  solver.solveUntilPhase("highDensityRouteSolver")
  expect(solver.portPointPathingSolver?.solved).toBeTrue()
  solver.step()

  expect(solver.highDensityRouteSolver).toBeDefined()
  expect(solver.portPointPathingSolver).toBeUndefined()
  expect(solver.uniformPortDistributionSolver).toBeUndefined()
})
