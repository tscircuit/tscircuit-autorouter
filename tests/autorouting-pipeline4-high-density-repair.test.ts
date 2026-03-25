import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -0.5, y: 0, layer: "top" },
        { x: 0.5, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
}

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_1",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  portPoints: [
    {
      connectionName: "conn1",
      x: -0.5,
      y: 0,
      z: 0,
    },
    {
      connectionName: "conn1",
      x: 0.5,
      y: 0,
      z: 0,
    },
  ],
}

const hdRoute: HighDensityRoute = {
  connectionName: "conn1",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -0.5, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
  ],
  vias: [],
}

test("Pipeline4HighDensityRepairSolver preserves simple no-op routes", () => {
  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [hdRoute],
    obstacles: [],
    repairMargin: 0.4,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([hdRoute])
})

test("pipeline4 inserts repair stage after high density and before stitching", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  const phaseNames = solver.pipelineDef.map((step) => step.solverName)

  expect(phaseNames.indexOf("highDensityRouteSolver")).toBeGreaterThanOrEqual(0)
  expect(phaseNames.indexOf("highDensityRepairSolver")).toBe(
    phaseNames.indexOf("highDensityRouteSolver") + 1,
  )
  expect(phaseNames.indexOf("highDensityStitchSolver")).toBe(
    phaseNames.indexOf("highDensityRepairSolver") + 1,
  )
})

test("pipeline4 stitch stage consumes repaired high density routes", () => {
  const rawRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }
  const repairedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0.25, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityRouteSolver = { routes: [rawRoute] } as any
  solver.highDensityRepairSolver = {
    getOutput: () => [repairedRoute],
  } as any

  const stitchStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityStitchSolver",
  )
  const [stitchParams] = stitchStep!.getConstructorParams(solver) as any

  expect(stitchParams.hdRoutes).toEqual([repairedRoute])
})
