import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeNode = () => ({
  capacityMeshNodeId: "cn1",
  center: { x: 10, y: 20 },
  width: 1,
  height: 1,
  portPoints: [
    { connectionName: "a", x: 9.5, y: 20, z: 0 },
    { connectionName: "a", x: 10.5, y: 20, z: 0 },
  ],
})

test("GrowShrinkHighDensityIntraNodeSolver grows after an inner solver failure", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 1,
  })

  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [],
    step() {
      this.failed = true
      this.error = "forced failure"
    },
    visualize() {
      return { lines: [], points: [], rects: [], circles: [] }
    },
  } as any

  solver.step()

  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(1)
  expect(solver.scaleFactor).toBe(2)
  expect(solver.failedSolvers.length).toBe(1)
})

test("GrowShrinkHighDensityIntraNodeSolver shrinks solved routes back to the original node", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  solver.scaleFactor = 2

  const scaledRoute: HighDensityIntraNodeRoute = {
    connectionName: "a",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 9, y: 20, z: 0 },
      { x: 10, y: 22, z: 0 },
      { x: 11, y: 20, z: 0 },
    ],
    vias: [{ x: 10, y: 22 }],
  }

  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [scaledRoute],
    step() {
      this.solved = true
    },
    visualize() {
      return { lines: [], points: [], rects: [], circles: [] }
    },
  } as any

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes[0].route).toEqual([
    { x: 9.5, y: 20, z: 0 },
    { x: 10, y: 21, z: 0 },
    { x: 10.5, y: 20, z: 0 },
  ])
  expect(solver.solvedRoutes[0].vias).toEqual([{ x: 10, y: 21 }])
})

test("Pipeline4 high-density stage opts into GrowShrinkHighDensityIntraNodeSolver", () => {
  const solver = new AutoroutingPipelineSolver4({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  expect(highDensityStep).toBeDefined()
  const [highDensityParams] = highDensityStep!.getConstructorParams({
    ...solver,
    uniformPortDistributionSolver: { getOutput: () => [] } as any,
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: [],
        inputNodeWithPortPoints: [],
      }),
    } as any,
  } as any)

  expect(
    (highDensityParams as any).useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
})

test("HighDensitySolver stats exposes highDensityResizeCount", () => {
  const node = makeNode()
  const route: HighDensityIntraNodeRoute = {
    connectionName: "a",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 9.5, y: 20, z: 0 },
      { x: 10.5, y: 20, z: 0 },
    ],
    vias: [],
  }
  const highDensitySolver = new HighDensitySolver({
    nodePortPoints: [],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })
  const growShrinkSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
  })
  growShrinkSolver.solved = true
  growShrinkSolver.solvedRoutes = [route]
  growShrinkSolver.growthAttempts = 2
  highDensitySolver.activeSubSolver = growShrinkSolver

  highDensitySolver.step()

  expect(highDensitySolver.stats.highDensityResizeCount).toBe(2)
})
