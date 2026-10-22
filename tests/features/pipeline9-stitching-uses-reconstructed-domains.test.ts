import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { SimpleRouteJson } from "lib/types"
import { createTopologyMergingTestNode } from "../fixtures/topology-merging-test-utils"

test("only rebuilt via domains opt into stricter terminal stitching", (): void => {
  for (const reconstructViaDomains of [false, true]) {
    const input: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
      connections: [],
      obstacles: [],
    }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solveUntilPhase("portPointPathingSolver")
    const topology = new TopologyMergingSolver({
      layerCount: 4,
      minViaPadDiameter: reconstructViaDomains ? 0.3 : undefined,
      nodeGroups: [
        {
          groupId: "global",
          isComponent: false,
          nodes: [0, 1, 2, 3].map((z) =>
            createTopologyMergingTestNode({
              id: `layer-${z}`,
              bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
              availableZ: [z],
            }),
          ),
        },
      ],
    })
    topology.solve()
    solver.topologyMergingSolver = topology
    expect(solver.topologyMergingSolver!.reconstructedViaDomainCount > 0).toBe(
      reconstructViaDomains,
    )
    Reflect.set(solver, "highDensityRouteSolver", { routes: [] })
    const stage = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    if (!stage) throw new Error("Missing route stitching stage")
    const [params] = stage.getConstructorParams(solver) as [
      ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0],
    ]
    expect(params.preferSameLayerTerminalEndpoints).toBe(true)
    expect(params.strictTerminalLayerIdentity).toBe(reconstructViaDomains)
  }
})
