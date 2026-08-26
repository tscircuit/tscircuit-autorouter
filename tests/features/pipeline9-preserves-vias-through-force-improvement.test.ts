import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 preserves vias through force improvement", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "route",
        pointsToConnect: [
          { x: -0.5, y: 0, layer: "bottom" },
          { x: 0.5, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "route", x: -0.5, y: 0, z: 1 },
      { connectionName: "route", x: 0.5, y: 0, z: 0 },
    ],
  }
  const rawRoute: HighDensityRoute = {
    connectionName: "route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.5, y: 0, z: 1 },
      { x: 0, y: 0.2, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
    vias: [{ x: 0, y: 0.2 }],
  }
  const pipeline9 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 0.1,
  })
  pipeline9.colorMap = { route: "#ff0000" }
  pipeline9.highDensityNodePortPoints = [nodeWithPortPoints]
  pipeline9.highDensityRouteSolver = {
    routes: [rawRoute],
  } as Pipeline9HighDensitySolver

  const forceImproveStep = pipeline9.pipelineDef.find(
    (step) => step.solverName === "highDensityForceImproveSolver",
  )!
  const [forceImproveParams] = forceImproveStep.getConstructorParams(
    pipeline9,
  ) as ConstructorParameters<typeof HighDensityForceImproveSolver>

  expect(forceImproveParams.hdRoutes[0]?.route).toEqual([
    { x: -0.5, y: 0, z: 1 },
    { x: 0, y: 0.2, z: 1 },
    { x: 0, y: 0.2, z: 0 },
    { x: 0.5, y: 0, z: 0 },
  ])
  const forceImproveSolver = new HighDensityForceImproveSolver(
    forceImproveParams,
  )
  forceImproveSolver.solve()

  expect(forceImproveSolver.failed).toBeFalse()
  expect(forceImproveSolver.solved).toBeTrue()
  expect(forceImproveSolver.getOutput()[0]?.vias).toEqual([{ x: 0, y: 0.2 }])
})
