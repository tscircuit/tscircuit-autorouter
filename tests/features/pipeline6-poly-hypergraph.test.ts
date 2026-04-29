import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { PolyHypergraphPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolyHypergraphPortPointPathingSolver"
import { PolySingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolySingleIntraNodeSolver"
import { ProjectHighDensityToPolygonSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/ProjectHighDensityToPolygonSolver"
import {
  applyMatrixToPoint,
  computeProjectedRect,
  getProjectedRectCorners,
  isPointInConvexPolygon,
  projectPointToRectBoundary,
} from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/geometry"
import type { PolyNodeWithPortPoints } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/types"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadScenarios } from "scripts/benchmark/scenarios"

const expectClose = (actual: number, expected: number, tolerance = 1e-6) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

test("Pipeline6 projectedRect area expansion preserves center and reaches polygon area", () => {
  const rotatedSquare = [
    { x: 0, y: -Math.SQRT2 },
    { x: Math.SQRT2, y: 0 },
    { x: 0, y: Math.SQRT2 },
    { x: -Math.SQRT2, y: 0 },
  ]
  const trapezoid = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ]

  const insideRect = computeProjectedRect(rotatedSquare, 0)
  const equivalentAreaRect = computeProjectedRect(trapezoid, 1)
  const expandedRect = computeProjectedRect(trapezoid, 2)
  const lowerBoundRect = computeProjectedRect(trapezoid, -1)

  expectClose(insideRect.center.x, 0)
  expectClose(insideRect.center.y, 0)
  expectClose(insideRect.width * insideRect.height, 4)
  expectClose(insideRect.ccwRotationDegrees, 45, 0.05)
  expectClose(
    equivalentAreaRect.width * equivalentAreaRect.height,
    equivalentAreaRect.polygonArea,
  )
  expectClose(equivalentAreaRect.polygonArea, 20)
  expectClose(
    expandedRect.width * expandedRect.height,
    equivalentAreaRect.polygonArea +
      (equivalentAreaRect.polygonArea -
        equivalentAreaRect.innerWidth * equivalentAreaRect.innerHeight),
  )
  expect(expandedRect.equivalentAreaExpansionFactor).toBe(2)
  expect(lowerBoundRect.equivalentAreaExpansionFactor).toBe(0)

  for (const corner of getProjectedRectCorners(insideRect)) {
    expect(isPointInConvexPolygon(corner, rotatedSquare)).toBe(true)
  }

  const projectedTopCorner = projectPointToRectBoundary(
    rotatedSquare[0]!,
    insideRect,
  )
  expectClose(projectedTopCorner.x, -1)
  expectClose(projectedTopCorner.y, -1)
  const distortedTopCorner = applyMatrixToPoint(
    insideRect.rectToPolygonMatrix,
    projectedTopCorner,
  )
  expectClose(distortedTopCorner.x, rotatedSquare[0]!.x)
  expectClose(distortedTopCorner.y, rotatedSquare[0]!.y)
})

test("Pipeline6 projectedRect handles sliver polygons without a singular homography", () => {
  const sliverPolygon = [
    { x: 4.349999, y: 10.45 },
    { x: 4.3500000000000005, y: 11.450000999999999 },
    { x: 4.349997, y: 10.5 },
  ]

  const projectedRect = computeProjectedRect(sliverPolygon, 0.25)

  expect(projectedRect.targetQuad).toHaveLength(4)
  expect(projectedRect.rectToPolygonMatrix.every(Number.isFinite)).toBe(true)
  expect(projectedRect.polygonToRectMatrix.every(Number.isFinite)).toBe(true)
})

test("Pipeline6 projectedRect can enforce a minimum local routing dimension", () => {
  const sliverPolygon = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 0.05 },
    { x: 0, y: 0.05 },
  ]

  const projectedRect = computeProjectedRect(sliverPolygon, 2, 0.45)

  expect(projectedRect.width).toBeGreaterThanOrEqual(0.45)
  expect(projectedRect.height).toBeGreaterThanOrEqual(0.45)
  expect(projectedRect.targetQuad).toHaveLength(4)
  expect(projectedRect.rectToPolygonMatrix.every(Number.isFinite)).toBe(true)
  expect(projectedRect.polygonToRectMatrix.every(Number.isFinite)).toBe(true)
})

test("Pipeline6 defaults projectedRect area expansion above equivalent area", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [],
  }

  const solver = new AutoroutingPipelineSolver6(srj)

  expect(solver.equivalentAreaExpansionFactor).toBe(2)
  expect(solver.minProjectedRectDimension).toBeCloseTo(0.45)
})

test("Pipeline6 falls back when constrained triangulation fails", async () => {
  const scenarios = await loadScenarios("dataset01")
  const circuit100 = scenarios.find(([name]) => name === "circuit100")?.[1]
  expect(circuit100).toBeDefined()

  const solver = new PolyHypergraphPortPointPathingSolver({
    srj: circuit100!,
  })

  expect(solver.usedUnconstrainedDelaunayFallback).toBe(true)
  expect(solver.convexRegions.regions.length).toBeGreaterThan(0)
})

test("Pipeline6 solves dataset01 circuit002 with minimum projected rect workspace", async () => {
  const scenarios = await loadScenarios("dataset01")
  const circuit002 = scenarios.find(([name]) => name === "circuit002")?.[1]
  expect(circuit002).toBeDefined()

  const solver = new AutoroutingPipelineSolver6(circuit002!, {
    effort: 1,
    equivalentAreaExpansionFactor: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})

test("PolySingleIntraNodeSolver solves in rect space before projection back to polygon", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 5, y: 4 },
    { x: 1, y: 4 },
  ]
  const node: PolyNodeWithPortPoints = {
    capacityMeshNodeId: "poly-node-1",
    center: { x: 3, y: 2 },
    width: 6,
    height: 4,
    availableZ: [0, 1],
    polygon,
    projectedRect: computeProjectedRect(polygon, 0.25),
    portPoints: [
      { connectionName: "a", x: 0.5, y: 0.5, z: 0 },
      { connectionName: "a", x: 5.5, y: 3.5, z: 0 },
      { connectionName: "b", x: 5.5, y: 0.5, z: 0 },
      { connectionName: "b", x: 0.5, y: 3.5, z: 0 },
    ],
  }

  const solver = new PolySingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    effort: 0.2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(2)

  for (const route of solver.solvedRoutes) {
    const endpoints = node.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    expect(endpoints).toHaveLength(2)
    const projectedStart = projectPointToRectBoundary(
      endpoints[0]!,
      node.projectedRect!,
    )
    const projectedEnd = projectPointToRectBoundary(
      endpoints[1]!,
      node.projectedRect!,
    )
    expect(route.route[0]).toMatchObject({
      x: projectedStart.x,
      y: projectedStart.y,
      z: endpoints[0]!.z,
    })
    expect(route.route[route.route.length - 1]).toMatchObject({
      x: projectedEnd.x,
      y: projectedEnd.y,
      z: endpoints[1]!.z,
    })
  }

  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "poly-single-intra-node",
  })

  const projectionSolver = new ProjectHighDensityToPolygonSolver({
    nodePortPoints: [node],
    routesByNodeId: new Map([[node.capacityMeshNodeId, solver.solvedRoutes]]),
  })
  projectionSolver.solve()

  expect(projectionSolver.solved).toBe(true)
  expect(projectionSolver.routes).toHaveLength(2)

  for (const route of projectionSolver.routes) {
    const endpoints = node.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    expect(route.route[0]).toMatchObject({
      x: endpoints[0]!.x,
      y: endpoints[0]!.y,
      z: endpoints[0]!.z,
    })
    expect(route.route[route.route.length - 1]).toMatchObject({
      x: endpoints[1]!.x,
      y: endpoints[1]!.y,
      z: endpoints[1]!.z,
    })
  }

  expect(projectionSolver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    svgName: "poly-project-high-density-to-polygon",
  })
})

test("Pipeline6 solves and snapshots a small obstacle route", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        center: { x: 5, y: 5 },
        width: 2,
        height: 2,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 1, y: 1, layer: "top" },
          { x: 9, y: 9, layer: "top" },
        ],
      },
      {
        name: "net2",
        pointsToConnect: [
          { x: 1, y: 9, layer: "top" },
          { x: 9, y: 1, layer: "top" },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver6(srj, {
    effort: 0.2,
    equivalentAreaExpansionFactor: 0.25,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.projectedHighDensityNodePortPoints?.length).toBeGreaterThan(0)
  expect(
    solver.projectedHighDensityNodePortPoints?.every((node) =>
      Boolean(node.projectedRect),
    ),
  ).toBe(true)
  expect(solver.highDensityRouteSolver?.routes.length).toBeGreaterThan(0)
  expect(
    solver.projectHighDensityToPolgonSolver?.routes.length,
  ).toBeGreaterThan(0)
  expect(solver.polyGraphSolver!.visualize().polygons?.length).toBeGreaterThan(
    0,
  )
  expect(solver.visualize().polygons?.length).toBeGreaterThan(0)
  expect(solver.getOutputSimpleRouteJson().traces).toHaveLength(2)

  expect(solver.polyGraphSolver!.visualize()).toMatchGraphicsSvg(
    import.meta.path,
    { svgName: "pipeline6-poly-graph" },
  )
  expect(solver.attachProjectedRectsSolver!.visualize()).toMatchGraphicsSvg(
    import.meta.path,
    { svgName: "pipeline6-projected-rects" },
  )
  expect(solver.highDensityRouteSolver!.visualize()).toMatchGraphicsSvg(
    import.meta.path,
    { svgName: "pipeline6-poly-high-density" },
  )
  expect(
    solver.projectHighDensityToPolgonSolver!.visualize(),
  ).toMatchGraphicsSvg(import.meta.path, {
    svgName: "pipeline6-project-high-density-to-polygon",
  })
  expect(
    convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()),
  ).toMatchGraphicsSvg(import.meta.path, { svgName: "pipeline6-output" })
})
