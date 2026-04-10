import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline4HighDensityForceImproveSolver } from "lib/solvers/HighDensityForceImproveSolver/Pipeline4HighDensityForceImproveSolver"
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

test("Pipeline4HighDensityForceImproveSolver preserves simple no-op routes", () => {
  const solver = new Pipeline4HighDensityForceImproveSolver({
    nodeWithPortPoints: [nodeWithPortPoints],
    hdRoutes: [hdRoute],
    totalStepsPerNode: 20,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual([hdRoute])
})

test("pipeline4 inserts force-improve stage after high density and before stitching", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  const phaseNames = solver.pipelineDef.map((step) => step.solverName)

  expect(phaseNames.indexOf("highDensityRouteSolver")).toBeGreaterThanOrEqual(0)
  expect(phaseNames.indexOf("highDensityForceImproveSolver")).toBe(
    phaseNames.indexOf("highDensityRouteSolver") + 1,
  )
  expect(phaseNames.indexOf("highDensityStitchSolver")).toBe(
    phaseNames.indexOf("highDensityForceImproveSolver") + 1,
  )
})

test("pipeline4 force-improve stage consumes raw high density routes", () => {
  const solver = new AutoroutingPipelineSolver4(srj)
  const rawRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }
  solver.srjWithPointPairs = srj
  solver.highDensityRouteSolver = { routes: [rawRoute] } as any

  const forceImproveStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityForceImproveSolver",
  )
  const [forceImproveParams] = forceImproveStep!.getConstructorParams(
    solver,
  ) as any

  expect(forceImproveParams.hdRoutes).toEqual([rawRoute])
})

test("pipeline4 stitch stage consumes force-improved high density routes", () => {
  const improvedRoute: HighDensityRoute = {
    ...hdRoute,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0, y: 0.1, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
  }

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.srjWithPointPairs = srj
  solver.highDensityForceImproveSolver = {
    getOutput: () => [improvedRoute],
  } as any

  const stitchStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityStitchSolver",
  )
  const [stitchParams] = stitchStep!.getConstructorParams(solver) as any

  expect(stitchParams.hdRoutes).toEqual([improvedRoute])
})

test(
  "pipeline4 real case force-improve changes output routes",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.highDensityNodePortPoints?.length ?? 0).toBeGreaterThan(0)
    expect(
      solver.highDensityForceImproveSolver?.sampleEntries.length ?? 0,
    ).toBeGreaterThan(0)

    const inputRoutes = solver.highDensityRouteSolver?.routes ?? []
    const improvedRoutes =
      solver.highDensityForceImproveSolver?.getOutput() ?? []

    expect(improvedRoutes.length).toBe(inputRoutes.length)

    const changedRouteCount = improvedRoutes.filter((route, index) => {
      const inputRoute = inputRoutes[index]
      return (
        JSON.stringify(route.route) !== JSON.stringify(inputRoute?.route) ||
        JSON.stringify(route.vias) !== JSON.stringify(inputRoute?.vias)
      )
    }).length

    expect(changedRouteCount).toBeGreaterThan(0)
  },
  { timeout: 60000 },
)

test(
  "pipeline4 real case stitch step input equals force-improved output",
  () => {
    const circuit003 = (dataset01 as Record<string, unknown>)
      .circuit003 as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver4(circuit003)

    solver.solve()

    const stitchStep = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    const [stitchParams] = stitchStep!.getConstructorParams(solver) as any
    const improvedRoutes =
      solver.highDensityForceImproveSolver?.getOutput() ?? []
    const rawRoutes = solver.highDensityRouteSolver?.routes ?? []

    expect(stitchParams.hdRoutes).toEqual(improvedRoutes)
    expect(stitchParams.hdRoutes.length).toBe(rawRoutes.length)

    const changedRouteCount = stitchParams.hdRoutes.filter(
      (route: HighDensityRoute, index: number) =>
        JSON.stringify(route.route) !==
          JSON.stringify(rawRoutes[index]?.route) ||
        JSON.stringify(route.vias) !== JSON.stringify(rawRoutes[index]?.vias),
    ).length

    expect(changedRouteCount).toBeGreaterThan(0)
  },
  { timeout: 60000 },
)
