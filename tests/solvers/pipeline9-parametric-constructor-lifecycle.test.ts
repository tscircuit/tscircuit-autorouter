import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineSolver9_Networked } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/AutoroutingPipelineSolver9_Networked"
import type { Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

test("parametric stage inspection supports empty jobs and requires the authoritative scene for physical jobs", (): void => {
  const emptyScene: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
  }
  const nodes: NodeWithPortPoints[] = []
  const inspectionSolver = new AutoroutingPipelineSolver9_Networked(emptyScene)
  Object.assign(inspectionSolver, {
    portPointPathingSolver: {
      getOutput: () => ({ nodesWithPortPoints: nodes, changedPreloadedTraceSections: [] }),
      computeNodePfMap: () => new Map<string, number>(),
    },
  })
  const stage = inspectionSolver.pipelineDef.find((step) => step.solverName === "highDensityRouteSolver")!
  const emptyParams = stage.getConstructorParams(inspectionSolver)[0] as Pipeline9HighDensitySolverParams
  expect(emptyParams.enableParametricConstruction).toBe(true)
  expect(emptyParams.traceWidthByConnection).toEqual({})
  expect(inspectionSolver.srjWithPointPairs).toBeUndefined()
  nodes.push({
    capacityMeshNodeId: "physical-job",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: [
      { connectionName: "generated-pair", x: -1, y: 0, z: 0 },
      { connectionName: "generated-pair", x: 1, y: 0, z: 0 },
    ],
  })
  expect(() => stage.getConstructorParams(inspectionSolver)).toThrow("nonempty high-density routing requires the completed point-pair scene")
  inspectionSolver.srjWithPointPairs = {
    ...emptyScene,
    connections: [{ name: "generated-pair", nominalTraceWidth: 0.4, pointsToConnect: [{ x: -1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" }] }],
  }
  const physicalParams = stage.getConstructorParams(inspectionSolver)[0] as Pipeline9HighDensitySolverParams
  expect(physicalParams.enableParametricConstruction).toBe(true)
  expect(physicalParams.traceWidthByConnection).toEqual({ "generated-pair": 0.4 })

  const actualScene: SimpleRouteJson = {
    ...emptyScene,
    connections: [{ name: "signal", nominalTraceWidth: 0.4, pointsToConnect: [{ x: -1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" }] }],
  }
  const ordinary = new AutoroutingPipelineSolver9_PreloadedTraceGraph(actualScene, { cacheProvider: null })
  ordinary.solveUntilPhase("highDensityStitchSolver")
  expect(ordinary.failed).toBe(false)
  expect(ordinary.highDensityRouteSolver!.solved).toBe(true)
  expect(ordinary.highDensityRouteSolver!.stats.parametricCompiledNodeCount).toBeGreaterThan(0)
  expect(ordinary.highDensityRouteSolver!.routes.some((route) => route.traceThickness === 0.4)).toBe(true)
})
