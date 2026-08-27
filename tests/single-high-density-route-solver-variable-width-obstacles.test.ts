import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const createAccurateViaNeighborSolver = (
  obstacleRoutes: HighDensityIntraNodeRoute[],
): SingleHighDensityRouteSolver => {
  return new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    obstacleRoutes,
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    viaDiameter: 0.2,
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    availableZ: [0, 1],
    honorObstacleRouteDimensions: true,
  })
}

test("SingleHighDensityRouteSolver preserves equal-width clearance and honors obstacle widths and aliases", (): void => {
  const equalWidthRoute: HighDensityIntraNodeRoute = {
    connectionName: "equal_obstacle",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: 0.14, z: 0 },
      { x: 8, y: 0.14, z: 0 },
    ],
    vias: [],
  }
  const equalWidthSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    obstacleRoutes: [equalWidthRoute],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    nearbySegmentClearance: 0.15,
    layerCount: 2,
  })
  expect(
    equalWidthSolver.doesPathToParentIntersectObstacle({
      x: 8,
      y: 0,
      z: 0,
      parent: { x: 2, y: 0, z: 0 },
    } as any),
  ).toBe(true)
  expect(
    equalWidthSolver.doesPathToParentIntersectObstacle({
      x: 8,
      y: -0.02,
      z: 0,
      parent: { x: 2, y: -0.02, z: 0 },
    } as any),
  ).toBe(false)

  const wideRoute: HighDensityIntraNodeRoute = {
    connectionName: "wide_obstacle",
    traceThickness: 0.3,
    viaDiameter: 0.6,
    route: [
      { x: 2, y: 0.24, z: 0 },
      { x: 8, y: 0.24, z: 0 },
    ],
    vias: [{ x: 5, y: 1 }],
  }
  const wideSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    obstacleRoutes: [wideRoute],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    viaDiameter: 0.2,
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    nearbySegmentClearance: 0.15,
    layerCount: 2,
    honorObstacleRouteDimensions: true,
  })
  expect(
    wideSolver.doesPathToParentIntersectObstacle({
      x: 8,
      y: 0,
      z: 0,
      parent: { x: 2, y: 0, z: 0 },
    } as any),
  ).toBe(true)
  expect(
    wideSolver.doesPathToParentIntersectObstacle({
      x: 8,
      y: -0.02,
      z: 0,
      parent: { x: 2, y: -0.02, z: 0 },
    } as any),
  ).toBe(false)
  expect(
    wideSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 1.45, z: 1 } as any,
      0.1,
      true,
    ),
  ).toBe(true)
  expect(
    wideSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 1.55, z: 1 } as any,
      0.1,
      true,
    ),
  ).toBe(false)

  const connectionAliasSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    rootConnectionName: "candidate_root",
    obstacleRoutes: [
      {
        connectionName: "connected_alias",
        rootConnectionName: "unmapped_root",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 2, y: 0.1, z: 0 },
          { x: 8, y: 0.1, z: 0 },
        ],
        vias: [{ x: 5, y: 1 }],
      },
    ],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    honorObstacleRouteDimensions: true,
    connMap: {
      areIdsConnected: (first: string, second: string): boolean => {
        return (
          (first === "candidate" && second === "connected_alias") ||
          (first === "connected_alias" && second === "candidate")
        )
      },
    } as any,
  })
  expect(
    connectionAliasSolver.obstacleSegments[0]?.connectedToCurrentConnection,
  ).toBe(true)
  expect(
    connectionAliasSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 1, z: 1 } as any,
      0.1,
      true,
    ),
  ).toBe(false)

  const rootAliasSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    rootConnectionName: "shared_root",
    obstacleRoutes: [
      {
        connectionName: "foreign_alias",
        rootConnectionName: "shared_root",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 2, y: 0.1, z: 0 },
          { x: 8, y: 0.1, z: 0 },
        ],
        vias: [],
      },
    ],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    honorObstacleRouteDimensions: true,
  })
  expect(
    rootAliasSolver.obstacleSegments[0]?.connectedToCurrentConnection,
  ).toBe(true)

  const layeredObstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "bottom_trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 4, y: 0, z: 3 },
        { x: 6, y: 0, z: 3 },
      ],
      vias: [],
    },
    {
      connectionName: "blind_via",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [
        { x: 5, y: 1, z: 0 },
        { x: 5, y: 1, z: 1 },
      ],
      vias: [{ x: 5, y: 1 }],
    },
  ]
  const blindViaSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    obstacleRoutes: layeredObstacleRoutes,
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    viaDiameter: 0.2,
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    honorObstacleRouteDimensions: true,
  })
  expect(
    blindViaSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 0, z: 1, parent: { x: 5, y: 0, z: 0 } } as any,
      0.1,
      true,
    ),
  ).toBe(false)
  expect(
    blindViaSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 1, z: 3 } as any,
      0.1,
      false,
    ),
  ).toBe(false)

  const throughViaSolver = new SingleHighDensityRouteSolver({
    connectionName: "candidate",
    obstacleRoutes: layeredObstacleRoutes,
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: -2, maxY: 2 },
    A: { x: 1, y: 0, z: 0 },
    B: { x: 9, y: 0, z: 0 },
    viaDiameter: 0.2,
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    layerCount: 4,
    honorObstacleRouteDimensions: true,
  })
  expect(
    throughViaSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 0, z: 1, parent: { x: 5, y: 0, z: 0 } } as any,
      0.1,
      true,
    ),
  ).toBe(true)
  expect(
    throughViaSolver.isNodeTooCloseToObstacle(
      { x: 5, y: 1, z: 3 } as any,
      0.1,
      false,
    ),
  ).toBe(true)

  const candidateNode = {
    x: 5,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const wideTraceAt = (y: number): HighDensityIntraNodeRoute => ({
    connectionName: "wide_trace",
    traceThickness: 0.3,
    viaDiameter: 0.3,
    route: [
      { x: 4, y, z: 0 },
      { x: 6, y, z: 0 },
    ],
    vias: [],
  })
  expect(
    createAccurateViaNeighborSolver([wideTraceAt(0.34)])
      .getNeighbors(candidateNode as any)
      .some((neighbor) => neighbor.z === 1),
  ).toBe(false)
  expect(
    createAccurateViaNeighborSolver([wideTraceAt(0.36)])
      .getNeighbors(candidateNode as any)
      .some((neighbor) => neighbor.z === 1),
  ).toBe(true)

  const wideViaAt = (y: number): HighDensityIntraNodeRoute => ({
    connectionName: "wide_via",
    traceThickness: 0.1,
    viaDiameter: 0.6,
    route: [
      { x: 5, y, z: 0 },
      { x: 5, y, z: 1 },
    ],
    vias: [{ x: 5, y }],
  })
  expect(
    createAccurateViaNeighborSolver([wideViaAt(0.49)])
      .getNeighbors(candidateNode as any)
      .some((neighbor) => neighbor.z === 1),
  ).toBe(false)
  expect(
    createAccurateViaNeighborSolver([wideViaAt(0.51)])
      .getNeighbors(candidateNode as any)
      .some((neighbor) => neighbor.z === 1),
  ).toBe(true)
})
