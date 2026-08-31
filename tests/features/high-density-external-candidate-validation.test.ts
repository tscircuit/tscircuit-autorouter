import { expect, test } from "bun:test"
import { getHighDensityIntraNodeRouteValidationError } from "lib/solvers/HighDensitySolver/validate-high-density-intra-node-routes"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("the portfolio rejects incomplete and physically invalid external routes", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
  })
  solver.initializeSolvers()
  const invalidCandidate = solver.supervisedSolvers!.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A12,
  )!.solver
  invalidCandidate.solved = true
  ;(invalidCandidate as any).getOutput = () => []

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.winningSolver).toBeUndefined()
  expect(invalidCandidate.solved).toBe(false)
  expect(invalidCandidate.failed).toBe(true)
  expect(invalidCandidate.error).toContain("output rejected")
  expect(solver.stats.rejectedExternalCandidateCount).toBe(1)

  const start = {
    connectionName: "cross-layer",
    rootConnectionName: "cross-layer",
    portPointId: "start",
    x: -1,
    y: 0,
    z: 0,
  }
  const end = {
    connectionName: "cross-layer",
    rootConnectionName: "cross-layer",
    portPointId: "end",
    x: 1,
    y: 0,
    z: 1,
  }
  const crossLayerSolver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "cross-layer-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [start, end],
      portPointsInPairs: [[start, end]],
    },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
  })
  crossLayerSolver.initializeSolvers()
  const missingViaCandidate = crossLayerSolver.supervisedSolvers!.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A12,
  )!.solver
  missingViaCandidate.solved = true
  ;(missingViaCandidate as any).getOutput = () => [
    {
      connectionName: "cross-layer",
      rootConnectionName: "cross-layer",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [start, end],
      vias: [],
    },
  ]
  for (const { solver: candidate } of crossLayerSolver.supervisedSolvers!) {
    if (candidate !== missingViaCandidate) {
      candidate.solved = false
      candidate.failed = true
    }
  }

  crossLayerSolver.step()

  expect(crossLayerSolver.solved).toBe(false)
  expect(missingViaCandidate.failed).toBe(true)
  expect(missingViaCandidate.error).toContain(
    "layer transition without a via",
  )

  const diagonalEnd = { ...end, connectionName: "diagonal" }
  const diagonalStart = { ...start, connectionName: "diagonal" }
  const crossingStart = {
    connectionName: "crossing",
    rootConnectionName: "crossing",
    portPointId: "crossing-start",
    x: 0,
    y: -1,
    z: 0,
  }
  const crossingEnd = {
    ...crossingStart,
    portPointId: "crossing-end",
    y: 1,
  }
  const materializedCollisionError =
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "materialized-crossing-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [
          diagonalStart,
          diagonalEnd,
          crossingStart,
          crossingEnd,
        ],
        portPointsInPairs: [
          [diagonalStart, diagonalEnd],
          [crossingStart, crossingEnd],
        ],
      },
      requirePairConnectivity: true,
      routes: [
        {
          connectionName: "diagonal",
          rootConnectionName: "cross-layer",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [diagonalStart, diagonalEnd],
          vias: [{ x: diagonalEnd.x, y: diagonalEnd.y }],
        },
        {
          connectionName: "crossing",
          rootConnectionName: "crossing",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [crossingStart, crossingEnd],
          vias: [],
        },
      ],
    })

  expect(materializedCollisionError).toContain("route geometry violations")

  const traceWidthOverrideError =
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "trace-width-override-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [diagonalStart, diagonalEnd],
        portPointsInPairs: [[diagonalStart, diagonalEnd]],
      },
      routes: [
        {
          connectionName: "diagonal",
          rootConnectionName: "cross-layer",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            { ...diagonalStart, traceThickness: 100 },
            diagonalEnd,
          ],
          vias: [{ x: diagonalEnd.x, y: diagonalEnd.y }],
        },
      ],
    })

  expect(traceWidthOverrideError).toContain(
    "unsupported per-point trace thickness",
  )

  const tStart = {
    connectionName: "t-junction",
    rootConnectionName: "t-junction",
    x: 0,
    y: 0,
    z: 0,
  }
  const tEnd = { ...tStart, x: 1, y: 1 }
  expect(
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "t-junction-node",
        center: { x: 1, y: 0.5 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [tStart, tEnd],
        portPointsInPairs: [[tStart, tEnd]],
      },
      requirePairConnectivity: true,
      routes: [
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [tStart, { ...tStart, x: 2 }],
          vias: [],
        },
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [{ ...tStart, x: 1 }, tEnd],
          vias: [],
        },
      ],
    }),
  ).toBeUndefined()

  const crossingJunctionStart = { ...tStart, x: -1 }
  const crossingJunctionEnd = { ...tEnd, x: 0 }
  expect(
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "crossing-junction-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [crossingJunctionStart, crossingJunctionEnd],
        portPointsInPairs: [
          [crossingJunctionStart, crossingJunctionEnd],
        ],
      },
      requirePairConnectivity: true,
      routes: [
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [crossingJunctionStart, { ...tStart, x: 1 }],
          vias: [],
        },
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [{ ...tStart, y: -1 }, crossingJunctionEnd],
          vias: [],
        },
      ],
    }),
  ).toBeUndefined()

  const dimensionError = getHighDensityIntraNodeRouteValidationError({
    nodeWithPortPoints: {
      capacityMeshNodeId: "dimension-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [tStart, tEnd],
      portPointsInPairs: [[tStart, tEnd]],
    },
    routes: [
      {
        connectionName: "t-junction",
        rootConnectionName: "wrong-root",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [tStart, tEnd],
        vias: [],
      },
    ],
    expectedTraceThickness: 0.2,
    expectedViaDiameter: 0.3,
  })
  expect(dimensionError).toContain("mismatched root metadata")
  expect(
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "dimension-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [tStart, tEnd],
        portPointsInPairs: [[tStart, tEnd]],
      },
      routes: [
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [tStart, tEnd],
          vias: [],
        },
      ],
      expectedTraceThickness: 0.2,
      expectedViaDiameter: 0.3,
    }),
  ).toContain("unexpected trace thickness")

  const duplicateViaTransitionError =
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "duplicate-via-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [diagonalStart, { ...diagonalStart, z: 0 }],
      },
      routes: [
        {
          connectionName: "diagonal",
          rootConnectionName: "cross-layer",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            diagonalStart,
            { ...diagonalStart, z: 1 },
            diagonalStart,
          ],
          vias: [{ x: diagonalStart.x, y: diagonalStart.y }],
        },
      ],
    })
  expect(duplicateViaTransitionError).toContain(
    "layer transition without a via",
  )

  const throughObstacleViaError =
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "through-obstacle-via-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [diagonalStart, diagonalEnd],
      },
      routes: [
        {
          connectionName: "diagonal",
          rootConnectionName: "cross-layer",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            { ...diagonalStart, toNextSegmentType: "through_obstacle" },
            diagonalEnd,
          ],
          vias: [{ x: diagonalStart.x, y: diagonalStart.y }],
        },
      ],
    })
  expect(throughObstacleViaError).toContain(
    "via without a layer transition",
  )

  const floatingComponentError =
    getHighDensityIntraNodeRouteValidationError({
      nodeWithPortPoints: {
        capacityMeshNodeId: "floating-node",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        availableZ: [0, 1],
        portPoints: [tStart, tEnd],
        portPointsInPairs: [[tStart, tEnd]],
      },
      requirePairConnectivity: true,
      routes: [
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [tStart, tEnd],
          vias: [],
        },
        {
          connectionName: "t-junction",
          rootConnectionName: "t-junction",
          traceThickness: 0.1,
          viaDiameter: 0.3,
          route: [
            { ...tStart, x: -1, y: -1 },
            { ...tStart, x: -0.5, y: -1 },
          ],
          vias: [],
        },
      ],
    })
  expect(floatingComponentError).toContain("floating route component")
})
