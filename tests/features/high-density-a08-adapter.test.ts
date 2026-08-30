import {
  findRouteGeometryViolations,
  type HighDensityIntraNodeRoute as A08Route,
} from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { HighDensitySolverA08IntraNodeAdapter } from "lib/solvers/HighDensitySolver/high-density-solver-a08-adapter"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import a08OneXNodes from "../fixtures/srj18-sample002-a08-one-x-nodes.json"

type MinimalNodeFixture = Omit<NodeWithPortPoints, "portPoints"> & {
  portPointsInPairs: [PortPoint, PortPoint][]
}

type RouteEndpoint = HighDensityIntraNodeRoute["route"][number] & {
  portPointId?: string
}

const materializeNode = (fixture: MinimalNodeFixture): NodeWithPortPoints => {
  const portPointsInPairs = structuredClone(fixture.portPointsInPairs)
  return {
    ...structuredClone(fixture),
    portPoints: portPointsInPairs.flat(),
    portPointsInPairs,
  }
}

const expectExactValidOutput = (
  solver: HighDensitySolverA08IntraNodeAdapter,
  node: NodeWithPortPoints,
): void => {
  const output = solver.getOutput()
  expect(output).toHaveLength(node.portPointsInPairs!.length)
  expect(findRouteGeometryViolations(output as A08Route[])).toHaveLength(0)

  const routesByConnectionName = new Map(
    output.map((route) => [route.connectionName, route]),
  )
  for (const [start, end] of node.portPointsInPairs!) {
    const route = routesByConnectionName.get(start.connectionName)
    expect(route).toBeDefined()
    expect(route!.rootConnectionName).toBe(start.rootConnectionName)
    expect(route!.regionId).toBe(node.capacityMeshNodeId)
    expect(route!.route[0] as RouteEndpoint).toMatchObject(start)
    expect(route!.route.at(-1) as RouteEndpoint).toMatchObject(end)
  }
}

test("A08 solves SRJ18 cmn_2 and cmn_4 at their physical size", () => {
  const explicitPairsNode = materializeNode(
    a08OneXNodes.explicitPairs as MinimalNodeFixture,
  )
  const explicitPairsParams = {
    nodeWithPortPoints: explicitPairsNode,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    traceMargin: 0.12,
    obstacles: [],
    effort: 1,
    minimumPairCount: 2,
    inputStrategy: "explicit-pairs" as const,
    shuffleSeed: 5,
  }

  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable(explicitPairsParams),
  ).toBe(true)
  const explicitPairsSolver = new HighDensitySolverA08IntraNodeAdapter(
    explicitPairsParams,
  )
  explicitPairsSolver.solve()
  expect(explicitPairsSolver.solved).toBe(true)
  expect(explicitPairsSolver.failed).toBe(false)
  expectExactValidOutput(explicitPairsSolver, explicitPairsNode)

  const sharedAnchorsNode = materializeNode(
    a08OneXNodes.sharedAnchors as MinimalNodeFixture,
  )
  const sharedAnchorsParams = {
    nodeWithPortPoints: sharedAnchorsNode,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    traceMargin: 0.1,
    obstacles: [],
    effort: 1,
    minimumPairCount: 2,
    inputStrategy: "shared-anchors" as const,
    shuffleSeed: 4,
  }

  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable(sharedAnchorsParams),
  ).toBe(true)
  const sharedAnchorsSolver = new HighDensitySolverA08IntraNodeAdapter(
    sharedAnchorsParams,
  )
  sharedAnchorsSolver.solve()
  expect(sharedAnchorsSolver.solved).toBe(true)
  expect(sharedAnchorsSolver.failed).toBe(false)
  expectExactValidOutput(sharedAnchorsSolver, sharedAnchorsNode)

  const rootlessSharedAnchorsNode = materializeNode(
    a08OneXNodes.sharedAnchors as MinimalNodeFixture,
  )
  for (const portPoint of rootlessSharedAnchorsNode.portPoints) {
    delete portPoint.rootConnectionName
  }
  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable({
      ...sharedAnchorsParams,
      nodeWithPortPoints: rootlessSharedAnchorsNode,
    }),
  ).toBe(true)

  const invalidStart = {
    connectionName: "invalid-bounds",
    rootConnectionName: "invalid-bounds",
    portPointId: "invalid-start",
    x: -1,
    y: 0,
    z: 0,
  }
  const invalidEnd = {
    connectionName: "invalid-bounds",
    rootConnectionName: "invalid-bounds",
    portPointId: "invalid-end",
    x: 1,
    y: 0,
    z: 0,
  }
  const invalidOutputSolver = new HighDensitySolverA08IntraNodeAdapter({
    nodeWithPortPoints: {
      capacityMeshNodeId: "invalid-bounds-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [invalidStart, invalidEnd],
      portPointsInPairs: [[invalidStart, invalidEnd]],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    traceMargin: 0.1,
    obstacles: [],
    effort: 1,
    minimumPairCount: 1,
    inputStrategy: "explicit-pairs",
    shuffleSeed: 0,
  })
  const [inputStart, inputEnd] =
    invalidOutputSolver.preparedInput.nodeWithPortPoints.portPointsInPairs![0]!
  const mockedUpstreamSolver = (invalidOutputSolver as any)
    .upstreamSolver
  mockedUpstreamSolver.step = () => {
    mockedUpstreamSolver.solved = true
  }
  mockedUpstreamSolver.getOutput = () => [
    {
      connectionName: inputStart.connectionName,
      rootConnectionName: inputStart.rootConnectionName,
      regionId: "invalid-bounds-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [inputStart, { x: 10, y: 0, z: 0 }, inputEnd],
      vias: [],
    },
  ]

  invalidOutputSolver.step()

  expect(invalidOutputSolver.solved).toBe(false)
  expect(invalidOutputSolver.failed).toBe(true)
  expect(invalidOutputSolver.error).toContain("out-of-bounds route point")

  const missingIdentityStart = {
    connectionName: "missing-identity",
    rootConnectionName: "missing-identity",
    x: -1,
    y: 0,
    z: 0,
  }
  const missingIdentityEnd = {
    connectionName: "missing-identity",
    rootConnectionName: "missing-identity",
    x: 1,
    y: 0,
    z: 0,
  }
  const missingIdentitySolver = new HighDensitySolverA08IntraNodeAdapter({
    nodeWithPortPoints: {
      capacityMeshNodeId: "missing-identity-node",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [missingIdentityStart, missingIdentityEnd],
      portPointsInPairs: [[missingIdentityStart, missingIdentityEnd]],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacles: [],
    minimumPairCount: 1,
    inputStrategy: "explicit-pairs",
  })
  const [syntheticStart, syntheticEnd] =
    missingIdentitySolver.preparedInput.nodeWithPortPoints
      .portPointsInPairs![0]!
  const missingIdentityUpstream = (missingIdentitySolver as any)
    .upstreamSolver
  let upstreamStepCount = 0
  missingIdentityUpstream.step = () => {
    upstreamStepCount++
    if (upstreamStepCount === 6) missingIdentityUpstream.solved = true
  }
  missingIdentityUpstream.getOutput = () => [
    {
      connectionName: syntheticStart.connectionName,
      rootConnectionName: syntheticStart.rootConnectionName,
      regionId: "missing-identity-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [syntheticStart, syntheticEnd],
      vias: [],
    },
  ]

  missingIdentitySolver.step()
  expect(missingIdentitySolver.solved).toBe(false)
  expect(upstreamStepCount).toBe(5)
  missingIdentitySolver.step()

  expect(missingIdentitySolver.solved).toBe(true)
  const restoredRoute = missingIdentitySolver.getOutput()[0]!
  expect(restoredRoute.connectionName).toBe("missing-identity")
  expect(restoredRoute.regionId).toBe("missing-identity-node")
  expect(restoredRoute.route[0]).toEqual(missingIdentityStart)
  expect(restoredRoute.route.at(-1)).toEqual(missingIdentityEnd)
})
