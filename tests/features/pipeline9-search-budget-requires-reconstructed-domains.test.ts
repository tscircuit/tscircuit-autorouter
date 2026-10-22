import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types"

test("inner copper alone does not extend a search without reconstructed via domains", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        layers: ["inner1"],
        connectedTo: [],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("portPointPathingSolver")
  expect(solver.topologyMergingSolver!.inputProblem.minViaPadDiameter).toBe(
    solver.viaDiameter,
  )
  expect(solver.topologyMergingSolver!.reconstructedViaDomainCount).toBe(0)
  const stage = solver.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )
  if (!stage) throw new Error("Missing port-point routing stage")
  const [params] = stage.getConstructorParams(solver) as [
    HgPortPointPathingSolverParams,
  ]
  expect(params.initialRoutingMaxIterations).toBeUndefined()
})
