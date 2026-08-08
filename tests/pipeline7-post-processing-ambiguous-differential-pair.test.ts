import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 rejects a differential pair member split across final routes", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    obstacles: [],
    differentialPairs: [
      { connectionNames: ["PAIR_P", "PAIR_N"], lengthTolerance: 0.01 },
    ],
    connections: [
      {
        name: "PAIR_P",
        pointsToConnect: [
          { x: 1, y: 2, layer: "top" },
          { x: 19, y: 2, layer: "top" },
        ],
      },
      {
        name: "PAIR_N",
        pointsToConnect: [
          { x: 1, y: 6, layer: "top" },
          { x: 19, y: 6, layer: "top" },
        ],
      },
    ],
  })
  const lengthMatchingPostProcessingStep = solver.pipelineDef.find(
    (step) => step.solverName === "differentialPairPostProcessingSolver",
  )!

  expect(() =>
    lengthMatchingPostProcessingStep.getConstructorParams({
      ...solver,
      netToPointPairsSolver: {
        newConnections: [
          {
            ...solver.srj.connections[0]!,
            name: "PAIR_P_mst0",
            __rootConnectionNames: ["PAIR_P"],
          },
          {
            ...solver.srj.connections[0]!,
            name: "PAIR_P_mst1",
            __rootConnectionNames: ["PAIR_P"],
          },
          {
            ...solver.srj.connections[1]!,
            name: "PAIR_N_mst0",
            __rootConnectionNames: ["PAIR_N"],
          },
        ],
      },
      exactGeometryDrcForceImproveSolver: { getOutput: () => [] },
    } as any),
  ).toThrow(
    'Pipeline7: differential pair connection "PAIR_P" must resolve to exactly one final point-pair connection, got 2',
  )
})
