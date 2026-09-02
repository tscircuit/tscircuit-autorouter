import { expect, test } from "bun:test"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 preserves an explicit via when locking a displaced terminal", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 1, y: 0, layer: "bottom", pcb_port_id: "end" },
        ],
      },
    ],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 0.1,
  })
  while (
    !pipeline.solved &&
    !pipeline.failed &&
    pipeline.getCurrentPhase() !== "globalDrcForceImproveSolver"
  ) {
    pipeline.step()
  }
  expect(pipeline.failed).toBeFalse()
  const connection = pipeline.netToPointPairsSolver!.newConnections[0]!
  const route: HighDensityRoute = {
    connectionName: connection.name,
    startPcbPortId: "start",
    endPcbPortId: "end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  pipeline.traceWidthSolver!.hdRoutesWithWidths = [route]
  pipeline.highDensityStitchSolver!.mergedHdRoutes = [route]
  const step = pipeline.pipelineDef.find(
    (step) => step.solverName === "globalDrcForceImproveSolver",
  )!
  const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<
    typeof GlobalDrcForceImproveSolver
  >

  expect(params.hdRoutes[0]?.route).toEqual([
    { x: -1, y: 0, z: 0, pcb_port_id: "start" },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1, pcb_port_id: "end" },
  ])
  const forceSolver = new GlobalDrcForceImproveSolver(params)
  forceSolver.solve()
  expect(forceSolver.solved).toBeTrue()
  expect(forceSolver.failed).toBeFalse()
  expect(forceSolver.getOutput()[0]?.vias).toHaveLength(1)
})
