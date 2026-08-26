import { expect, test } from "bun:test"
import { getTransitionSlideRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-pipeline9-via-pad-clearance-repairs"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-fixed-route-copper"
import type { HighDensityRoute } from "lib/types/high-density-types"

type TransitionStack = {
  x: number
  y: number
  z: number[]
}

const getTransitionStacks = (route: HighDensityRoute): TransitionStack[] => {
  const stacks: TransitionStack[] = []
  for (let pointIndex = 0; pointIndex < route.route.length - 1; pointIndex++) {
    const point = route.route[pointIndex]!
    const next = route.route[pointIndex + 1]!
    if (point.x !== next.x || point.y !== next.y || point.z === next.z) continue
    const previous = route.route[pointIndex - 1]
    if (previous && previous.x === point.x && previous.y === point.y) continue
    const z = [point.z]
    let stackIndex = pointIndex + 1
    while (
      stackIndex < route.route.length &&
      route.route[stackIndex]!.x === point.x &&
      route.route[stackIndex]!.y === point.y
    ) {
      z.push(route.route[stackIndex]!.z)
      stackIndex++
    }
    stacks.push({ x: point.x, y: point.y, z })
  }
  return stacks
}

const getWireSegmentStartMetadata = (route: HighDensityRoute): unknown[] =>
  route.route.slice(0, -1).flatMap((point, pointIndex) => {
    const next = route.route[pointIndex + 1]!
    if (point.x === next.x && point.y === next.y) return []
    const { x: _x, y: _y, z: _z, ...metadata } = point
    return [metadata]
  })

const getWireGeometryIdentity = (route: HighDensityRoute): unknown[] =>
  getPipeline9RouteCopperGeometry(route).wireSegments.map((segment) => ({
    start: { x: segment.start.x, y: segment.start.y },
    end: { x: segment.end.x, y: segment.end.y },
    width: segment.width,
  }))

test("Pipeline9 via-pad transition slides preserve stacks and stop at route guards", () => {
  const fixedRoute: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 2, z: 0, pcb_port_id: "fixed_start" },
      { x: 10, y: 2, z: 0, pcb_port_id: "fixed_end" },
    ],
    vias: [],
  }
  const guardedRoute: HighDensityRoute = {
    connectionName: "owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "owner_start" },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 5, y: 0, z: 1 },
      { x: 5, y: 0, z: 2 },
      { x: 6, y: 0, z: 2 },
      { x: 7, y: 0, z: 2 },
      { x: 8, y: 0, z: 2, pcb_port_id: "interior_terminal" },
      { x: 9, y: 0, z: 2 },
      { x: 10, y: 0, z: 2, pcb_port_id: "owner_end" },
    ],
    vias: [{ x: 5, y: 0 }],
  }
  const guardedCandidates = getTransitionSlideRoutes({
    routes: [guardedRoute, fixedRoute],
    routeIndex: 0,
    site: {
      startIndex: 5,
      endIndex: 7,
      x: 5,
      y: 0,
      fromZ: 0,
      toZ: 2,
    },
  })
  const guardedStacks = guardedCandidates.map((candidateRoutes) => {
    expect(candidateRoutes[1]).toBe(fixedRoute)
    expect(getWireGeometryIdentity(candidateRoutes[0]!)).toEqual(
      getWireGeometryIdentity(guardedRoute),
    )
    expect(getWireSegmentStartMetadata(candidateRoutes[0]!)).toEqual(
      getWireSegmentStartMetadata(guardedRoute),
    )
    const stacks = getTransitionStacks(candidateRoutes[0]!)
    expect(stacks).toHaveLength(1)
    expect(stacks[0]!.z).toEqual([0, 1, 2])
    return stacks[0]!
  })

  expect(guardedStacks.map(({ x, y }) => ({ x, y }))).toEqual([
    { x: 4, y: 0 },
    { x: 3, y: 0 },
    { x: 6, y: 0 },
    { x: 7, y: 0 },
  ])

  const terminalTransitionRoute = structuredClone(guardedRoute)
  terminalTransitionRoute.route[6]!.pcb_port_id = "stack_terminal"
  expect(
    getTransitionSlideRoutes({
      routes: [terminalTransitionRoute, fixedRoute],
      routeIndex: 0,
      site: {
        startIndex: 5,
        endIndex: 7,
        x: 5,
        y: 0,
        fromZ: 0,
        toZ: 2,
      },
    }),
  ).toEqual([])

  const jumperTargetRoute = structuredClone(guardedRoute)
  jumperTargetRoute.route[4]!.insideJumperPad = true
  expect(
    getTransitionSlideRoutes({
      routes: [jumperTargetRoute, fixedRoute],
      routeIndex: 0,
      site: {
        startIndex: 5,
        endIndex: 7,
        x: 5,
        y: 0,
        fromZ: 0,
        toZ: 2,
      },
    }).map((candidateRoutes) => getTransitionStacks(candidateRoutes[0]!)[0]!.x),
  ).toEqual([6, 7])

  const jumperTransitionRoute = structuredClone(guardedRoute)
  jumperTransitionRoute.route[6]!.insideJumperPad = true
  expect(
    getTransitionSlideRoutes({
      routes: [jumperTransitionRoute, fixedRoute],
      routeIndex: 0,
      site: {
        startIndex: 5,
        endIndex: 7,
        x: 5,
        y: 0,
        fromZ: 0,
        toZ: 2,
      },
    }),
  ).toEqual([])

  const transitionBoundedRoute: HighDensityRoute = {
    connectionName: "owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "owner_start" },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 0, z: 1 },
      { x: 5, y: 0, z: 2 },
      { x: 6, y: 0, z: 2 },
      { x: 7, y: 0, z: 2 },
      { x: 7, y: 0, z: 0 },
      { x: 8, y: 0, z: 0, pcb_port_id: "owner_end" },
    ],
    vias: [
      { x: 2, y: 0 },
      { x: 5, y: 0 },
      { x: 7, y: 0 },
    ],
  }
  const transitionBoundedCandidates = getTransitionSlideRoutes({
    routes: [transitionBoundedRoute, fixedRoute],
    routeIndex: 0,
    site: {
      startIndex: 6,
      endIndex: 7,
      x: 5,
      y: 0,
      fromZ: 1,
      toZ: 2,
    },
  })
  const relocatedTargetSites = transitionBoundedCandidates.map(
    (candidateRoutes) => {
      expect(candidateRoutes[1]).toBe(fixedRoute)
      const targetStack = getTransitionStacks(candidateRoutes[0]!).find(
        (stack) => stack.z.length === 2 && stack.z[0] === 1 && stack.z[1] === 2,
      )
      expect(targetStack).toBeDefined()
      return { x: targetStack!.x, y: targetStack!.y }
    },
  )

  expect(relocatedTargetSites).toEqual([
    { x: 4, y: 0 },
    { x: 3, y: 0 },
    { x: 6, y: 0 },
  ])

  const taperedRoute: HighDensityRoute = {
    connectionName: "tapered",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "tapered_start", traceThickness: 0.1 },
      { x: 1, y: 0, z: 0, traceThickness: 0.11 },
      { x: 2, y: 0, z: 0, traceThickness: 0.12 },
      { x: 2, y: 0, z: 1, traceThickness: 0.13 },
      { x: 3, y: 0, z: 1, traceThickness: 0.3 },
      { x: 4, y: 0, z: 1, traceThickness: 0.2 },
      { x: 5, y: 0, z: 1, pcb_port_id: "tapered_end", traceThickness: 0.1 },
    ],
    vias: [{ x: 2, y: 0 }],
  }
  const taperedCandidates = getTransitionSlideRoutes({
    routes: [taperedRoute],
    routeIndex: 0,
    site: {
      startIndex: 2,
      endIndex: 3,
      x: 2,
      y: 0,
      fromZ: 0,
      toZ: 1,
    },
  })
  expect(
    taperedCandidates.map(
      (candidateRoutes) => getTransitionStacks(candidateRoutes[0]!)[0]!.x,
    ),
  ).toEqual([1, 3, 4])
  for (const candidateRoutes of taperedCandidates) {
    expect(getWireSegmentStartMetadata(candidateRoutes[0]!)).toEqual(
      getWireSegmentStartMetadata(taperedRoute),
    )
    expect(getWireGeometryIdentity(candidateRoutes[0]!)).toEqual(
      getWireGeometryIdentity(taperedRoute),
    )
  }
})
