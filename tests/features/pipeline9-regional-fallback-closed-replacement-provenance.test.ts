import { expect, type Mock, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  createRegionalFallbackProblem,
  type FixedRouteSection,
  type RegionalFallbackProblem,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type InvalidMutationState = {
  mask: boolean[] | undefined
  collapseMarkedSegment: boolean
  error: string
}

test("Pipeline9 captures surviving mutation copper when both clipped anchors coincide", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "closed_replacement",
    center: { x: 1, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [],
  }
  const firstSourceRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed_0",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 4,
    preloadedRoutePositionEnd: 5,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const secondSourceRoute: PreloadedHighDensityRoute = {
    ...firstSourceRoute,
    connectionName: "fixed_1",
    preloadedRouteIndex: 1,
    preloadedRoutePositionStart: 5,
    preloadedRoutePositionEnd: 6,
    route: [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
    ],
  }
  const fixedRoutes: PreloadedHighDensityRoute[] = [
    firstSourceRoute,
    secondSourceRoute,
  ]
  const fixedRoutesBefore: PreloadedHighDensityRoute[] =
    structuredClone(fixedRoutes)
  const connMap: ConnectivityMap = new ConnectivityMap({})
  const problem: RegionalFallbackProblem = createRegionalFallbackProblem(
    node,
    fixedRoutes,
  )
  const section: FixedRouteSection =
    problem.fixedRouteSectionsByConnectionName.get("fixed_0")!
  expect(section.start.point).toEqual({ x: 0, y: 0, z: 0 })
  expect(section.end.point).toEqual(section.start.point)

  const replacement: HighDensityRoute = {
    connectionName: firstSourceRoute.connectionName,
    rootConnectionName: firstSourceRoute.rootConnectionName,
    traceThickness: firstSourceRoute.traceThickness,
    viaDiameter: firstSourceRoute.viaDiameter,
    route: [
      section.start.point,
      { x: 0.5, y: 0.5, z: 0 },
      { x: 1, y: 0, z: 0 },
      section.end.point,
    ],
    vias: [],
  }
  const createCompletedSolver: (
    sourceRoutes: PreloadedHighDensityRoute[],
    acceptedReplacement: HighDensityRoute,
  ) => Pipeline9HighDensitySolver = (
    sourceRoutes: PreloadedHighDensityRoute[],
    acceptedReplacement: HighDensityRoute,
  ): Pipeline9HighDensitySolver => {
    const regionalProblem: RegionalFallbackProblem =
      createRegionalFallbackProblem(node, sourceRoutes)
    const solver: Pipeline9HighDensitySolver = new Pipeline9HighDensitySolver({
      nodePortPoints: [],
      fixedHdRoutes: sourceRoutes,
      connMap,
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.5,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
    })
    const regionalSolver: Pipeline9RegionalFallbackSolver =
      new Pipeline9RegionalFallbackSolver({
        nodeWithPortPoints: regionalProblem.nodeWithPortPoints,
        connMap,
        colorMap: {},
        obstacles: [],
        layerCount: 2,
        viaDiameter: 0.5,
        traceWidth: 0.15,
        obstacleMargin: 0.15,
        effort: 1,
      })
    regionalSolver.highDensitySolver.routes.push(acceptedReplacement)
    regionalSolver.solved = true
    solver.activeNode = node
    solver.activeFallbackSolver = regionalSolver
    solver.activeFallbackFixedRouteSections = new Map(
      regionalProblem.fixedRouteSectionsByConnectionName,
    )
    return solver
  }

  const invalidStates: InvalidMutationState[] = [
    {
      mask: undefined,
      collapseMarkedSegment: false,
      error: "is missing its mutation provenance",
    },
    {
      mask: [true],
      collapseMarkedSegment: false,
      error: "has 1 segments, expected 5",
    },
    {
      mask: [false, false, false, false, false],
      collapseMarkedSegment: false,
      error: "has no surviving mutation segment",
    },
    {
      mask: [false, true, false, false, false],
      collapseMarkedSegment: true,
      error: "has no surviving mutation segment",
    },
  ]
  invalidStates.forEach((invalidState: InvalidMutationState): void => {
    const solver: Pipeline9HighDensitySolver = createCompletedSolver(
      fixedRoutes,
      replacement,
    )
    const maskRead: Mock<(connectionName: string) => boolean[] | undefined> =
      spyOn(solver.preloadedTraceMutationMasks, "get").mockImplementation(
        (connectionName: string): boolean[] | undefined => {
          if (!solver.preloadedTraceMutationMasks.has(connectionName)) {
            return undefined
          }
          if (invalidState.collapseMarkedSegment) {
            const route: HighDensityRoute["route"] =
              solver.fixedRouteReplacements.get(connectionName)!.route
            route[2] = route[1]!
          }
          return invalidState.mask
        },
      )
    expect((): void => solver._step()).toThrow(invalidState.error)
    maskRead.mockRestore()
  })

  const solver: Pipeline9HighDensitySolver = createCompletedSolver(
    fixedRoutes,
    replacement,
  )
  expect((): void => solver._step()).not.toThrow()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.solvedNodeCount).toBe(1)
  const updatedRoutes: PreloadedHighDensityRoute[] =
    solver.getUpdatedFixedHdRoutes()
  expect(updatedRoutes).toHaveLength(1)
  expect(updatedRoutes[0]!.route).toEqual([
    firstSourceRoute.route[0]!,
    ...replacement.route,
    secondSourceRoute.route.at(-1)!,
  ])
  const mask: boolean[] = solver.preloadedTraceMutationMasks.get("fixed_0")!
  expect(mask).toHaveLength(updatedRoutes[0]!.route.length - 1)
  expect(mask).toEqual([false, true, true, true, false])
  expect(solver.preloadedTraceMutationMasks.has("fixed_1")).toBeFalse()
  expect(fixedRoutes).toEqual(fixedRoutesBefore)

  const openSourceRoutes: PreloadedHighDensityRoute[] = [
    firstSourceRoute,
    {
      ...secondSourceRoute,
      route: [secondSourceRoute.route[0]!, { x: 3, y: 0, z: 0 }],
    },
  ]
  const openSourceRoutesBefore: PreloadedHighDensityRoute[] =
    structuredClone(openSourceRoutes)
  const openReplacement: HighDensityRoute = {
    ...replacement,
    route: [...replacement.route.slice(0, -1), { x: 2, y: 0, z: 0 }],
  }
  const openSolver: Pipeline9HighDensitySolver = createCompletedSolver(
    openSourceRoutes,
    openReplacement,
  )
  expect((): void => openSolver._step()).not.toThrow()
  expect(openSolver.stats.solvedNodeCount).toBe(1)
  expect(openSolver.preloadedTraceMutationMasks.get("fixed_0")).toEqual([
    true,
    true,
    true,
    true,
    true,
  ])
  expect(openSolver.getUpdatedFixedHdRoutes()[0]!.route).toEqual([
    firstSourceRoute.route[0]!,
    ...openReplacement.route,
    openSourceRoutes[1]!.route.at(-1)!,
  ])
  expect(openSourceRoutes).toEqual(openSourceRoutesBefore)
})
