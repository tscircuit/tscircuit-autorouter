import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

test("Pipeline9 computes every node probability from one pathing output", (): void => {
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
  solver.solveUntilPhase("highDensityRouteSolver")
  expect(solver.failed).toBe(false)
  const pathingSolver = solver.portPointPathingSolver!
  expect(pathingSolver.solved).toBe(true)
  const inputNodes = pathingSolver.getOutput().inputNodeWithPortPoints
  const expected = new Map(
    inputNodes.map((node) => [
      node.capacityMeshNodeId,
      pathingSolver.computeNodePf(node),
    ]),
  )
  expect(expected.size).toBeGreaterThan(1)
  expect([...expected.values()].some((value) => value !== null)).toBe(true)

  const getOutput = pathingSolver.getOutput.bind(pathingSolver)
  let outputConversions = 0
  pathingSolver.getOutput = (): ReturnType<typeof getOutput> => {
    outputConversions += 1
    return getOutput()
  }
  const probabilities = pathingSolver.computeNodePfMap()
  expect(probabilities).toEqual(expected)
  expect(outputConversions).toBe(1)
})
