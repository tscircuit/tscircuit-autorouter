import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 repairs every node when the board has more than 80 repair samples", () => {
  const nodes: NodeWithPortPoints[] = Array.from(
    { length: 81 },
    (_, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index * 3, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        { connectionName: `route-${index}`, x: index * 3 - 1, y: 0, z: 0 },
        { connectionName: `route-${index}`, x: index * 3 + 1, y: 0, z: 0 },
      ],
    }),
  )
  const routes: HighDensityRoute[] = nodes.map((node, index) => ({
    regionId: node.capacityMeshNodeId,
    connectionName: `route-${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: node.portPoints.map(({ x, y, z }) => ({ x, y, z })),
    vias: [],
  }))
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -2, maxX: 244, minY: -2, maxY: 2 },
      obstacles: [],
      connections: routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: route.route.map(({ x, y }) => ({
          x,
          y,
          layer: "top",
        })),
      })),
    },
    { cacheProvider: null },
  )
  pipeline.highDensityNodePortPoints = nodes
  pipeline.highDensityForceImproveSolver = {
    getOutput: (): HighDensityRoute[] => routes,
  } as typeof pipeline.highDensityForceImproveSolver
  const stage = pipeline.pipelineDef.find(
    (step) => step.solverName === "highDensityRepairSolver",
  )!
  const params = stage.getConstructorParams(
    pipeline,
  )[0] as ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0]
  const repair = new Pipeline4HighDensityRepairSolver(params)

  expect(repair.sampleEntries).toHaveLength(81)
  repair.solve()
  expect(repair.failed).toBe(false)
  expect(repair.solved).toBe(true)
  expect(repair.stats.repairedNodeCount).toBe(81)
  expect(repair.stats.repairedRouteCount).toBe(81)
  expect(repair.getOutput()).toEqual(routes)
})
