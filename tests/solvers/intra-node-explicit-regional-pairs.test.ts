import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("intra-node routes preserve explicit regional pairs", (): void => {
  const topStart: PortPoint = {
    connectionName: "shared_connection",
    rootConnectionName: "shared_net",
    portPointId: "top_start",
    x: -0.25,
    y: -0.2,
    z: 0,
  }
  const topEnd: PortPoint = {
    ...topStart,
    portPointId: "top_end",
    x: 0.25,
  }
  const bottomStart: PortPoint = {
    ...topStart,
    portPointId: "bottom_start",
    y: 0.2,
    z: 1,
  }
  const bottomEnd: PortPoint = {
    ...bottomStart,
    portPointId: "bottom_end",
    x: 0.25,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "explicit-regional-pairs",
    center: { x: 0, y: 0 },
    width: 0.8,
    height: 0.8,
    availableZ: [0, 1],
    useExplicitPortPointPairs: true,
    portPoints: [topStart, bottomStart, topEnd, bottomEnd],
    portPointsInPairs: [
      [topStart, topEnd],
      [bottomStart, bottomEnd],
    ],
  }
  const originalNode = structuredClone(node)
  const params = {
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ shared_net: ["shared_connection"] }),
    traceWidth: 0.1,
    viaDiameter: 0.3,
  }
  const standalone = new IntraNodeRouteSolver(params)
  const portfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    enableNegotiatedSearch: true,
  })
  const portfolioCandidate = portfolio.generateSolver({})
  const linkedTopStart: PortPoint = {
    ...topStart,
    pcb_port_id: "pcb_top_start",
    nextPortPointId: topEnd.portPointId,
  }
  const linkedTopEnd: PortPoint = {
    ...topEnd,
    pcb_port_id: "pcb_top_end",
    prevPortPointId: topStart.portPointId,
  }
  const linkedBottomStart: PortPoint = {
    ...bottomStart,
    pcb_port_id: "pcb_bottom_start",
    nextPortPointId: bottomEnd.portPointId,
  }
  const linkedBottomEnd: PortPoint = {
    ...bottomEnd,
    pcb_port_id: "pcb_bottom_end",
    prevPortPointId: bottomStart.portPointId,
  }
  const linkedNode: NodeWithPortPoints = {
    ...node,
    portPoints: [
      linkedTopStart,
      linkedBottomStart,
      linkedTopEnd,
      linkedBottomEnd,
    ],
    portPointsInPairs: [
      [linkedTopStart, linkedTopEnd],
      [linkedBottomStart, linkedBottomEnd],
    ],
  }
  const originalLinkedNode = structuredClone(linkedNode)
  const linkedPortfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    nodeWithPortPoints: linkedNode,
    enableNegotiatedSearch: true,
  })
  const repeatedPairNode: NodeWithPortPoints = {
    ...node,
    portPointsInPairs: [
      [topStart, topEnd],
      [bottomStart, bottomEnd],
      [topEnd, topStart],
      [bottomEnd, bottomStart],
      [topStart, topEnd],
    ],
  }
  const originalRepeatedPairNode = structuredClone(repeatedPairNode)
  const repeatedPairSolver = new IntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: repeatedPairNode,
  })
  const standaloneStrategies = portfolio.getCombinationDefs().flat()
  for (const strategy of [
    "throughObstacle",
    "singleLayerNoDifferentRootIntersections",
    "multiHeadPolyLine",
    "closedFormSingleTrace",
    "highDensityA01",
    "highDensityA03",
    "highDensityA13",
  ]) {
    expect(standaloneStrategies).not.toContain(strategy)
  }
  for (const strategy of [
    "majorCombinations",
    "noVias",
    "orderings50",
    "flipTraceAlignmentDirection",
  ]) {
    expect(standaloneStrategies).toContain(strategy)
  }
  const linkedStrategies = linkedPortfolio.getCombinationDefs().flat()
  expect(linkedStrategies).toContain("highDensityA01")
  expect(linkedStrategies).toContain("highDensityA13")
  expect(linkedStrategies).not.toContain("multiHeadPolyLine")

  for (const solver of [
    standalone,
    portfolioCandidate,
    repeatedPairSolver,
    portfolio,
    linkedPortfolio,
  ]) {
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.error).toBeNull()
    expect(solver.solvedRoutes).toHaveLength(2)
    const actualEndpointPairs = solver.solvedRoutes.map((route): string => {
      const start = route.route[0]!
      const end = route.route.at(-1)!
      expect(route.connectionName).toBe("shared_connection")
      expect(route.rootConnectionName).toBe("shared_net")
      expect(route.vias).toEqual([])
      expect(
        route.route.every((point): boolean => point.z === start.z),
      ).toBeTrue()
      return [`${start.x},${start.y},${start.z}`, `${end.x},${end.y},${end.z}`]
        .sort()
        .join("|")
    })
    expect(actualEndpointPairs.sort()).toEqual([
      "-0.25,-0.2,0|0.25,-0.2,0",
      "-0.25,0.2,1|0.25,0.2,1",
    ])
  }

  const chainStart: PortPoint = {
    ...topStart,
    portPointId: "chain_a",
    nextPortPointId: "chain_b",
  }
  const chainMiddle: PortPoint = {
    ...topStart,
    portPointId: "chain_b",
    prevPortPointId: "chain_a",
    nextPortPointId: "chain_c",
    x: 0,
    y: 0.2,
  }
  const chainEnd: PortPoint = {
    ...topEnd,
    portPointId: "chain_c",
    prevPortPointId: "chain_b",
  }
  const chainNode: NodeWithPortPoints = {
    ...node,
    capacityMeshNodeId: "connected-regional-pairs",
    portPoints: [chainStart, chainMiddle, chainEnd],
    portPointsInPairs: [
      [chainStart, chainMiddle],
      [chainMiddle, chainEnd],
    ],
  }
  const originalChainNode = structuredClone(chainNode)
  const chainPortfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    nodeWithPortPoints: chainNode,
  })
  const chainStrategies = chainPortfolio.getCombinationDefs().flat()
  expect(chainStrategies).toContain("highDensityA01")
  expect(chainStrategies).not.toContain("multiHeadPolyLine")
  chainPortfolio.solve()
  expect(chainPortfolio.solved).toBeTrue()
  expect(chainPortfolio.failed).toBeFalse()
  expect(chainPortfolio.solvedRoutes).toHaveLength(2)
  const chainEndpointPairs = chainPortfolio.solvedRoutes.map(
    (route): string => {
      expect(route.connectionName).toBe("shared_connection")
      expect(route.vias).toEqual([])
      expect(route.route.every((point): boolean => point.z === 0)).toBeTrue()
      const start = route.route[0]!
      const end = route.route.at(-1)!
      return [`${start.x},${start.y},${start.z}`, `${end.x},${end.y},${end.z}`]
        .sort()
        .join("|")
    },
  )
  expect(chainEndpointPairs.sort()).toEqual([
    "-0.25,-0.2,0|0,0.2,0",
    "0,0.2,0|0.25,-0.2,0",
  ])

  const legacy = new IntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: { ...node, useExplicitPortPointPairs: undefined },
  })
  legacy.solve()
  expect(legacy.solved).toBeTrue()
  expect(legacy.solvedRoutes).toHaveLength(3)
  expect(
    legacy.solvedRoutes.some((route): boolean => route.vias.length > 0),
  ).toBeTrue()
  const explicitlyLegacy = new IntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: { ...node, useExplicitPortPointPairs: false },
  })
  explicitlyLegacy.solve()
  expect(explicitlyLegacy.solvedRoutes).toEqual(legacy.solvedRoutes)

  const legacyWithoutPairs = new IntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: {
      ...node,
      useExplicitPortPointPairs: undefined,
      portPointsInPairs: undefined,
    },
  })
  legacyWithoutPairs.solve()
  expect(legacyWithoutPairs.solvedRoutes).toEqual(legacy.solvedRoutes)

  const highDensity = new HighDensitySolver({
    nodePortPoints: [linkedNode],
    connMap: params.connMap,
    traceWidth: params.traceWidth,
    viaDiameter: params.viaDiameter,
    preserveTerminalPcbPortIds: true,
  })
  highDensity.solve()
  expect(highDensity.solved).toBeTrue()
  expect(highDensity.failed).toBeFalse()
  expect(highDensity.routes).toHaveLength(2)
  for (const route of highDensity.routes) {
    const start = route.route[0]!
    const end = route.route.at(-1)!
    const expectedStart = linkedNode.portPoints.find(
      (point): boolean =>
        point.x === start.x && point.y === start.y && point.z === start.z,
    )
    const expectedEnd = linkedNode.portPoints.find(
      (point): boolean =>
        point.x === end.x && point.y === end.y && point.z === end.z,
    )
    expect(expectedStart).toBeDefined()
    expect(expectedEnd).toBeDefined()
    expect(route.startPcbPortId).toBe(expectedStart!.pcb_port_id)
    expect(route.endPcbPortId).toBe(expectedEnd!.pcb_port_id)
    expect(route.vias).toEqual([])
    expect(
      route.route.every((point): boolean => point.z === start.z),
    ).toBeTrue()
  }

  expect(
    (): IntraNodeRouteSolver =>
      new IntraNodeRouteSolver({
        ...params,
        nodeWithPortPoints: {
          ...node,
          portPointsInPairs: [[topStart, topEnd]],
        },
      }),
  ).toThrow(/unpaired/i)
  for (const missingPairs of [undefined, []]) {
    expect(
      (): IntraNodeRouteSolver =>
        new IntraNodeRouteSolver({
          ...params,
          nodeWithPortPoints: { ...node, portPointsInPairs: missingPairs },
        }),
    ).toThrow(/required/i)
  }
  const contradictoryBottomEnd: PortPoint = {
    ...bottomEnd,
    rootConnectionName: "unrelated_net",
  }
  expect(
    (): IntraNodeRouteSolver =>
      new IntraNodeRouteSolver({
        ...params,
        nodeWithPortPoints: {
          ...node,
          portPoints: [topStart, bottomStart, topEnd, contradictoryBottomEnd],
          portPointsInPairs: [
            [topStart, topEnd],
            [bottomStart, contradictoryBottomEnd],
          ],
        },
      }),
  ).toThrow(/root/i)

  const alternatePairNode: NodeWithPortPoints = {
    ...node,
    portPointsInPairs: [
      [topStart, bottomStart],
      [topEnd, bottomEnd],
    ],
  }
  for (const Solver of [
    CachedIntraNodeRouteSolver,
    CachedPortfolioSingleIntraNodeSolver,
  ]) {
    const originalPairCache = new Solver({ ...params, cacheProvider: null })
    const alternatePairCache = new Solver({
      ...params,
      nodeWithPortPoints: alternatePairNode,
      cacheProvider: null,
    })
    expect(originalPairCache.computeCacheKeyAndTransform().cacheKey).not.toBe(
      alternatePairCache.computeCacheKeyAndTransform().cacheKey,
    )
    const legacyPairCache = new Solver({
      ...params,
      nodeWithPortPoints: { ...node, useExplicitPortPointPairs: false },
      cacheProvider: null,
    })
    const legacyWithoutPairCache = new Solver({
      ...params,
      nodeWithPortPoints: {
        ...node,
        useExplicitPortPointPairs: undefined,
        portPointsInPairs: undefined,
      },
      cacheProvider: null,
    })
    expect(originalPairCache.computeCacheKeyAndTransform().cacheKey).not.toBe(
      legacyPairCache.computeCacheKeyAndTransform().cacheKey,
    )
    expect(legacyPairCache.computeCacheKeyAndTransform().cacheKey).toBe(
      legacyWithoutPairCache.computeCacheKeyAndTransform().cacheKey,
    )
  }
  expect(node).toEqual(originalNode)
  expect(linkedNode).toEqual(originalLinkedNode)
  expect(repeatedPairNode).toEqual(originalRepeatedPairNode)
  expect(chainNode).toEqual(originalChainNode)
})
