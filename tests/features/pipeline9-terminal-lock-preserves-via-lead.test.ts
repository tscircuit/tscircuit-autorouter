import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import type { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 terminal locking preserves the lead from a nearby via", (): void => {
  const via = { x: 277.56114414, y: 103.37980086 }
  const terminal = { x: 277.5966, y: 103.43580024 }
  const route: HighDensityRoute = {
    connectionName: "route",
    startPcbPortId: "top-pad",
    endPcbPortId: "bottom-pad",
    traceThickness: 0.1524,
    viaDiameter: 0.2032,
    route: [{ ...via, z: 0 }, { ...via, z: 0 }, { ...via, z: 7 }],
    vias: [],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    {
      layerCount: 8,
      minTraceWidth: 0.1524,
      bounds: { minX: 270, minY: 100, maxX: 280, maxY: 110 },
      obstacles: [],
      connections: [
        {
          name: "route",
          pointsToConnect: [
            { ...via, layer: "top", pcb_port_id: "top-pad" },
            { ...terminal, layer: "bottom", pcb_port_id: "bottom-pad" },
          ],
        },
      ],
    },
    { cacheProvider: null },
  )
  pipeline.solveUntilPhase("topologyPlanningSolver")
  pipeline.traceWidthSolver = {
    getHdRoutesWithWidths: (): HighDensityRoute[] => [route],
  } as TraceWidthSolver
  const step = pipeline.pipelineDef.find(
    (candidate) => candidate.solverName === "globalDrcForceImproveSolver",
  )!
  const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<
    typeof GlobalDrcForceImproveSolver
  >
  const output = params.hdRoutes[0]!

  expect(output.route.at(-1)).toMatchObject({
    ...terminal,
    z: 7,
    pcb_port_id: "bottom-pad",
  })
  const transitions = output.route.flatMap((point, index) => {
    const previous = output.route[index - 1]
    if (!previous || previous.z === point.z) return []
    return [{ start: previous, end: point }]
  })
  expect(transitions).toHaveLength(1)
  expect(transitions[0]).toEqual({
    start: { ...via, z: 0 },
    end: { ...via, z: 7 },
  })
})
