import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { SupervisedSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type Candidate = SupervisedSolver<BaseSolver>
type PortfolioOptions = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0]

function makeNode(
  name: string,
  width: number,
  rows: number[],
): NodeWithPortPoints {
  const ports = rows.flatMap((y, index) => [
    {
      connectionName: `${name}_${index}`,
      rootConnectionName: `${name}_net${index}`,
      x: -width / 2,
      y,
      z: 0,
    },
    {
      connectionName: `${name}_${index}`,
      rootConnectionName: `${name}_net${index}`,
      x: width / 2,
      y,
      z: 0,
    },
  ])
  return {
    capacityMeshNodeId: name,
    center: { x: 0, y: 0 },
    width,
    height: 4,
    availableZ: [0, 1],
    portPoints: ports,
  }
}

function makeOptions(
  node: NodeWithPortPoints,
  enabled?: boolean,
): PortfolioOptions {
  const nets: Record<string, string[]> = {}
  for (const point of node.portPoints) {
    nets[point.rootConnectionName!] = [
      point.connectionName,
      point.rootConnectionName!,
    ]
  }
  return {
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap(nets),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    layerCount: 2,
    captureSearchDebug: false,
    ...(enabled === undefined
      ? {}
      : { enableEarlyCoarsePortfolioProbe: enabled }),
  }
}

function getCoarse(
  portfolio: PortfolioSingleIntraNodeSolver,
): CachedIntraNodeRouteSolver {
  const entry = portfolio.supervisedSolvers!.find(
    ({ hyperParameters }) =>
      hyperParameters.CELL_SIZE_FACTOR === 2 &&
      hyperParameters.SHUFFLE_SEED === 3 &&
      hyperParameters.VIA_PENALTY_FACTOR_2 === 1,
  )
  if (!entry || !(entry.solver instanceof CachedIntraNodeRouteSolver)) {
    throw new Error("Expected the one native early coarse candidate")
  }
  const solver = entry.solver
  return solver
}

function nativeRoutes(node: NodeWithPortPoints): HighDensityIntraNodeRoute[] {
  const names = [
    ...new Set(node.portPoints.map((point) => point.connectionName)),
  ]
  return names.map((connectionName) => {
    const ports = node.portPoints.filter(
      (point) => point.connectionName === connectionName,
    )
    return {
      connectionName,
      rootConnectionName: ports[0]!.rootConnectionName,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: ports.map(({ x, y, z }) => ({ x, y, z })),
      vias: [],
    }
  })
}

function failOnActualStep(solver: BaseSolver): void {
  solver._step = function (): void {
    this.failed = true
    this.error = "Scripted native candidate failure"
    this.progress = 0
  }
}

class CustomPortfolio extends PortfolioSingleIntraNodeSolver {}

test("early coarse adds one physical candidate while retaining native work and complete original fallback", () => {
  const node = makeNode("native_default", 6, [-1, 0, 1])
  const ordinary = new PortfolioSingleIntraNodeSolver(makeOptions(node))
  ordinary.initializeSolvers()
  const baseline = ordinary.supervisedSolvers!
  for (const enabled of [false, true]) {
    const portfolio = new PortfolioSingleIntraNodeSolver(
      makeOptions(node, enabled),
    )
    portfolio.initializeSolvers()
    const entries = portfolio.supervisedSolvers!
    const coarse = enabled ? getCoarse(portfolio) : undefined
    expect(
      entries
        .filter((entry) => entry.solver !== coarse)
        .map((entry) => entry.hyperParameters),
    ).toEqual(baseline.map((entry) => entry.hyperParameters))
    expect(
      entries
        .filter((entry) => entry.solver !== coarse)
        .map((entry) => entry.solver.MAX_ITERATIONS),
    ).toEqual(baseline.map((entry) => entry.solver.MAX_ITERATIONS))
    expect(entries.length).toBe(baseline.length + Number(enabled))
    expect(portfolio.MIN_SUBSTEPS).toBe(ordinary.MIN_SUBSTEPS)
    expect(portfolio.GREEDY_MULTIPLIER).toBe(ordinary.GREEDY_MULTIPLIER)
    expect(portfolio.stats.dynamicExpansionWorkBudget).toBe(
      ordinary.stats.dynamicExpansionWorkBudget,
    )
    expect(portfolio.MAX_ITERATIONS).toBeGreaterThanOrEqual(
      ordinary.MAX_ITERATIONS,
    )
    const retained = entries.filter((entry) => entry.solver !== coarse)
    for (let index = 0; index < retained.length; index++) {
      const current = retained[index]!.solver
      const original = baseline[index]!.solver
      if (
        current instanceof CachedIntraNodeRouteSolver &&
        original instanceof CachedIntraNodeRouteSolver
      ) {
        expect(current.cacheProvider).toBe(original.cacheProvider)
        expect(current.computeCacheKeyAndTransform().cacheKey).toBe(
          original.computeCacheKeyAndTransform().cacheKey,
        )
      }
    }
    expect(
      "enableEarlyCoarsePortfolioProbe" in portfolio.constructorParams,
    ).toBe(false)
    if (coarse) {
      const fine = entries.find(
        ({ hyperParameters }) =>
          hyperParameters.CELL_SIZE_FACTOR === 0.5 &&
          hyperParameters.SHUFFLE_SEED === 3 &&
          hyperParameters.VIA_PENALTY_FACTOR_2 === 1,
      )!
      expect(coarse.hyperParameters).toEqual({
        ...fine.hyperParameters,
        CELL_SIZE_FACTOR: 2,
      })
      expect(coarse.cacheProvider).toBeNull()
      expect(coarse.MAX_ITERATIONS).toBe(fine.solver.MAX_ITERATIONS)
      const prefix = entries.slice(
        0,
        entries.findIndex((entry) => entry.solver === coarse),
      )
      expect(
        prefix.filter(
          ({ solver }) => solver instanceof CachedIntraNodeRouteSolver,
        ).length,
      ).toBe(2)
      expect(coarse.traceWidth).toBe(0.1)
      expect(coarse.obstacleMargin).toBe(0.15)
      expect(coarse.nodeWithPortPoints).toBe(node)
    }
    portfolio.solve()
    expect(portfolio.solved).toBe(true)
    expect(portfolio.failed).toBe(false)
    expect(coarse?.iterations ?? 0).toBe(0)
  }

  const transitionNode = makeNode("coarse_transition", 5, [-1.2, -0.2, 0.9])
  transitionNode.portPoints.at(-1)!.z = 1
  for (const corpusNode of [
    makeNode("coarse_wide", 8, [-1.1, 0, 1.1]),
    makeNode("coarse_narrow", 2.4, [-0.8, 0.8]),
    transitionNode,
  ]) {
    const portfolio = new PortfolioSingleIntraNodeSolver(
      makeOptions(corpusNode, true),
    )
    portfolio.initializeSolvers()
    const coarse = getCoarse(portfolio)
    const originalObjects = portfolio.supervisedSolvers!.filter(
      (entry) => entry.solver !== coarse,
    )
    const originalIterations = originalObjects.map(
      (entry) => entry.solver.iterations,
    )
    const originalCaps = originalObjects.map(
      (entry) => entry.solver.MAX_ITERATIONS,
    )
    coarse.solve()
    expect(coarse.solved).toBe(true)
    expect(coarse.failed).toBe(false)
    if (corpusNode === transitionNode) {
      expect(coarse.solvedRoutes.some((route) => route.vias.length > 0)).toBe(
        true,
      )
    }
    portfolio.step()
    expect(portfolio.solved).toBe(true)
    expect<BaseSolver | undefined>(portfolio.winningSolver).toBe(coarse)
    expect(originalObjects.map((entry) => entry.solver.iterations)).toEqual(
      originalIterations,
    )
    expect(originalObjects.map((entry) => entry.solver.MAX_ITERATIONS)).toEqual(
      originalCaps,
    )
    expect(
      Object.getOwnPropertyDescriptor(portfolio, "totalCandidateWork")!.value,
    ).toBe(coarse.iterations)
    for (let left = 0; left < portfolio.solvedRoutes.length; left++) {
      for (
        let right = left + 1;
        right < portfolio.solvedRoutes.length;
        right++
      ) {
        expect(
          doPipeline9RoutesHaveCopperConflict({
            left: portfolio.solvedRoutes[left]!,
            right: portfolio.solvedRoutes[right]!,
            clearance: 0.15,
            layerCount: 2,
          }),
        ).toBe(false)
      }
    }
  }

  const rejection = new PortfolioSingleIntraNodeSolver(
    makeOptions(makeNode("fallback", 6, [-1, 0, 1]), true),
  )
  rejection.initializeSolvers()
  const rejectedCoarse = getCoarse(rejection)
  const originals = rejection.supervisedSolvers!.filter(
    (entry) => entry.solver !== rejectedCoarse,
  )
  const originalCaps = originals.map((entry) => entry.solver.MAX_ITERATIONS)
  for (const { solver } of originals) failOnActualStep(solver)
  rejectedCoarse._step = function (): void {
    const routes = nativeRoutes(this.nodeWithPortPoints)
    routes[0]!.route.splice(1, 0, { x: 0, y: 1, z: 0 })
    routes[1]!.route.splice(1, 0, { x: 0, y: -1, z: 0 })
    this.solvedRoutes = routes
    this.solved = true
    this.progress = 1
  }
  while (!rejectedCoarse.failed && !rejection.failed) rejection.step()
  expect(rejectedCoarse.iterations).toBe(1)
  expect(rejectedCoarse.failed).toBe(true)
  expect(rejectedCoarse.solved).toBe(false)
  expect(rejectedCoarse.error).toContain("original copper clearance")
  expect(rejection.solved).toBe(false)
  expect(rejection.failed).toBe(false)
  expect(rejection.winningSolver).toBeUndefined()
  expect(rejection.solvedRoutes).toEqual([])
  const fallback = originals.find(
    ({ solver }) =>
      solver instanceof CachedIntraNodeRouteSolver && !solver.failed,
  )!
  if (!(fallback.solver instanceof CachedIntraNodeRouteSolver)) {
    throw new Error("Expected an untouched original cached fallback")
  }
  fallback.solver._step = function (): void {
    this.solvedRoutes = nativeRoutes(this.nodeWithPortPoints)
    this.solved = true
    this.progress = 1
  }
  rejection.step()
  expect(rejection.solved).toBe(true)
  expect<BaseSolver | undefined>(rejection.winningSolver).toBe(fallback.solver)
  expect(originals.map((entry) => entry.solver.MAX_ITERATIONS)).toEqual(
    originalCaps,
  )
  expect(
    Object.getOwnPropertyDescriptor(rejection, "totalCandidateWork")!.value,
  ).toBe(
    rejection.supervisedSolvers!.reduce(
      (sum, entry) => sum + entry.solver.iterations,
      0,
    ),
  )

  const impossible = makeNode("terminal_overlap", 3, [0, 0])
  const failed = new PortfolioSingleIntraNodeSolver({
    ...makeOptions(impossible, true),
    rejectOverlappingTerminals: true,
  })
  expect(failed.failed).toBe(true)
  expect(failed.supervisedSolvers).toBeUndefined()
  expect(failed.error).toContain("terminals overlap")

  for (const Constructor of [
    CustomPortfolio,
    CachedPortfolioSingleIntraNodeSolver,
  ]) {
    const custom = new Constructor(makeOptions(node, true))
    custom.initializeSolvers()
    expect(custom.supervisedSolvers!.length).toBe(baseline.length)
  }
  const customCache = new PortfolioSingleIntraNodeSolver({
    ...makeOptions(node, true),
    cacheProvider: null,
  })
  customCache.initializeSolvers()
  expect(customCache.supervisedSolvers!.length).toBe(baseline.length)

  let nativeFactoryCandidateCount: number | undefined
  for (const enabled of [false, true]) {
    const regular = createPipeline9RegularNodeSolver({
      nodeWithPortPoints: node,
      connMap: makeOptions(node).connMap!,
      colorMap: {},
      effort: 1,
      nodePfById: {},
      obstacles: [],
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      layerCount: 2,
      enableEarlyCoarsePortfolioProbe: enabled,
    })
    regular.step()
    expect(regular.activeSubSolver).toBeInstanceOf(
      GrowShrinkHighDensityIntraNodeSolver,
    )
    const grow =
      regular.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
    grow.step()
    const inner = grow.activeSubSolver ?? grow.winningSolver
    if (!inner) throw new Error("Expected the actual native regular portfolio")
    expect(inner.enableEarlyCoarsePortfolioProbe).toBe(enabled)
    if (!enabled) nativeFactoryCandidateCount = inner.supervisedSolvers!.length
    expect(inner.supervisedSolvers!.length).toBe(
      nativeFactoryCandidateCount! + Number(enabled),
    )
    const resized = new GrowShrinkHighDensityIntraNodeSolver({
      ...makeOptions(node, true),
      maxGrowthAttempts: 1,
    })
    resized.scaleFactor = 2
    const createScaledPortfolio = Reflect.get(resized, "createActiveSubSolver")
    if (typeof createScaledPortfolio !== "function") {
      throw new Error("Expected the native grow attempt factory")
    }
    Reflect.apply(createScaledPortfolio, resized, [])
    expect(resized.activeSubSolver!.enableEarlyCoarsePortfolioProbe).toBe(false)
    resized.activeSubSolver!.initializeSolvers()
    expect(resized.activeSubSolver!.supervisedSolvers!.length).toBe(
      baseline.length,
    )
  }
})
