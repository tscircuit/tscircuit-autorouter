import { expect, spyOn, test } from "bun:test"
import {
  HighDensitySolverA11,
  getRouteGeometryViolationError,
} from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9RegularNodeSolver,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { doRoutesCoverNodePortPointPairsExactlyOnce } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

const makePortfolio = (nodeWithPortPoints = makeNode()) => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
  })
  solver.initializeSolvers()
  return solver
}

const getNativeGridCandidates = (solver: PortfolioSingleIntraNodeSolver) => ({
  a01Candidate: solver.supervisedSolvers?.find(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === 0,
  ),
  a11Candidate: solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  ),
})

class TestPipeline9HighDensitySolver extends Pipeline9HighDensitySolver {
  finishRegularNode(): void {
    this.finishActiveNode([])
  }
}

test("Pipeline9 integrates bounded native A11 with exact routes and unchanged scaled routing", () => {
  // Pipeline9 A11 solves a difficult node at native size only
  {
    const nodeWithPortPoints = sample002Cmn279 as NodeWithPortPoints
    const solver = createPipeline9RegularNodeSolver({
      nodeWithPortPoints,
      connMap: new ConnectivityMap({}),
      colorMap: {},
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
      nodePfById: { cmn_279: 0 },
      obstacles: [],
      layerCount: 2,
    })

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.highDensityResizeCount).toBe(0)
    expect(solver.stats.solverNodeCount.HighDensitySolverA11).toBe(1)
    expect(solver.nodeSolveMetadataById.get("cmn_279")?.solverType).toBe(
      "HighDensitySolverA11",
    )
    expect(solver.routes).toHaveLength(4)
    expect(getRouteGeometryViolationError(solver.routes)).toBeNull()
    expect(
      doRoutesCoverNodePortPointPairsExactlyOnce(
        solver.routes,
        nodeWithPortPoints,
      ),
    ).toBe(true)
    expect(
      doRoutesCoverNodePortPointPairsExactlyOnce(
        [...solver.routes, solver.routes[0]!],
        nodeWithPortPoints,
      ),
    ).toBe(false)
  }

  // native portfolios include only A11 while grown portfolios stay coarse
  {
    const nodeWithPortPoints = sample002Cmn279 as NodeWithPortPoints
    const solverParams = {
      nodeWithPortPoints,
      connMap: new ConnectivityMap({}),
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
      obstacles: [],
      layerCount: 2,
    }
    const nativePortfolio = new PortfolioSingleIntraNodeSolver(solverParams)
    nativePortfolio.initializeSolvers()
    const a11Candidate = nativePortfolio.supervisedSolvers?.find(
      ({ solver: candidateSolver }) =>
        candidateSolver instanceof HighDensitySolverA11,
    )?.solver
    expect(
      nativePortfolio.supervisedSolvers!.some(
        ({ solver: candidateSolver }) =>
          candidateSolver.getSolverName() === "HighDensitySolverA12",
      ),
    ).toBe(false)

    expect(a11Candidate).toBeInstanceOf(HighDensitySolverA11)
    if (!(a11Candidate instanceof HighDensitySolverA11)) {
      throw new Error("Native portfolio did not create an A11 candidate")
    }
    const standaloneA11 = new HighDensitySolverA11({
      nodeWithPortPoints,
      viaDiameter: 0.3,
      viaMinDistFromBorder: 0.15,
      traceMargin: 0.1,
      traceThickness: 0.1,
      effort: 1,
      hyperParameters: { shuffleSeed: 0 },
    })
    standaloneA11.setup()
    expect(a11Candidate.MAX_ITERATIONS).toBe(standaloneA11.MAX_ITERATIONS)
    expect(Number.isFinite(a11Candidate.MAX_ITERATIONS)).toBe(true)
    expect(a11Candidate.MAX_ITERATIONS).toBeGreaterThan(0)
    expect(a11Candidate.rows).toBeDefined()
    expect(a11Candidate.iterations).toBe(0)

    for (const { solver: candidate } of nativePortfolio.supervisedSolvers!) {
      candidate.failed = true
    }
    nativePortfolio.step()
    expect(nativePortfolio.adaptiveSearchExpanded).toBe(true)
    expect(
      nativePortfolio.supervisedSolvers?.filter(
        ({ solver: candidateSolver }) =>
          candidateSolver instanceof HighDensitySolverA11,
      ),
    ).toHaveLength(1)

    const grownSolver = new GrowShrinkHighDensityIntraNodeSolver(solverParams)
    grownSolver.scaleFactor = 2
    grownSolver.step()

    expect(grownSolver.activeSubSolver).toBeInstanceOf(
      PortfolioSingleIntraNodeSolver,
    )
    expect(
      grownSolver.activeSubSolver?.supervisedSolvers?.some(
        ({ solver: candidateSolver }) =>
          candidateSolver.getSolverName() === "HighDensitySolverA11" ||
          candidateSolver.getSolverName() === "HighDensitySolverA12",
      ),
    ).toBe(false)
  }

  // A11 uses the same grid-solver scheduling on sparse and congested nodes
  {
    const sparsePortfolio = makePortfolio()
    const {
      a01Candidate: sparseA01Candidate,
      a11Candidate: sparseA11Candidate,
    } = getNativeGridCandidates(sparsePortfolio)

    expect(sparseA11Candidate?.f).toBe(sparseA01Candidate?.f)
    expect(sparsePortfolio.computeG(sparseA11Candidate!.solver)).toBe(
      sparsePortfolio.computeG(sparseA01Candidate!.solver),
    )
    expect(sparseA11Candidate?.solver.iterations).toBe(0)

    const sparseNode = makeNode()
    const denseNode = {
      ...sparseNode,
      portPoints: Array.from({ length: 10 }, (_, index) => ({
        connectionName: `connection-${Math.floor(index / 2)}`,
        x: index % 2 === 0 ? 9.5 : 10.5,
        y: 20,
        z: 0,
      })),
    }
    const congestedPortfolio = makePortfolio(denseNode)
    const {
      a01Candidate: congestedA01Candidate,
      a11Candidate: congestedA11Candidate,
    } = getNativeGridCandidates(congestedPortfolio)

    expect(congestedA11Candidate?.f).toBe(congestedA01Candidate?.f)
    expect(congestedPortfolio.computeG(congestedA11Candidate!.solver)).toBe(
      congestedPortfolio.computeG(congestedA01Candidate!.solver),
    )
  }

  // native grid coverage matches exact endpoints and their net exactly once
  {
    const start: PortPoint = {
      connectionName: "net-a",
      rootConnectionName: "root-a",
      x: -1,
      y: 0,
      z: 0,
    }
    const end: PortPoint = { ...start, x: 1 }
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [start, end],
    }
    const route: HighDensityIntraNodeRoute = {
      connectionName: "net-a",
      rootConnectionName: "root-a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [start, end],
      vias: [],
    }
    const otherNetRoute = {
      ...route,
      connectionName: "net-b",
      rootConnectionName: "root-b",
    }
    const twoNetNode = {
      ...node,
      portPoints: [
        ...node.portPoints,
        ...node.portPoints.map((point) => ({
          ...point,
          connectionName: "net-b",
          rootConnectionName: "root-b",
        })),
      ],
    }

    expect({
      valid: doRoutesCoverNodePortPointPairsExactlyOnce([route], node),
      reversed: doRoutesCoverNodePortPointPairsExactlyOnce(
        [{ ...route, route: [end, start] }],
        node,
      ),
      wrongConnection: doRoutesCoverNodePortPointPairsExactlyOnce(
        [{ ...route, connectionName: "net-b" }],
        node,
      ),
      wrongRoot: doRoutesCoverNodePortPointPairsExactlyOnce(
        [{ ...route, rootConnectionName: "root-b" }],
        node,
      ),
      shiftedEndpoint: doRoutesCoverNodePortPointPairsExactlyOnce(
        [{ ...route, route: [{ ...start, x: start.x + 1e-7 }, end] }],
        node,
      ),
      missing: doRoutesCoverNodePortPointPairsExactlyOnce([], node),
      duplicate: doRoutesCoverNodePortPointPairsExactlyOnce(
        [route, route],
        node,
      ),
      missingCoincidentNet: doRoutesCoverNodePortPointPairsExactlyOnce(
        [route],
        twoNetNode,
      ),
      bothCoincidentNets: doRoutesCoverNodePortPointPairsExactlyOnce(
        [route, otherNetRoute],
        twoNetNode,
      ),
      explicitPairs: doRoutesCoverNodePortPointPairsExactlyOnce([route], {
        ...twoNetNode,
        portPointsInPairs: [[start, end]],
      }),
    }).toEqual({
      valid: true,
      reversed: true,
      wrongConnection: false,
      wrongRoot: false,
      shiftedEndpoint: false,
      missing: false,
      duplicate: false,
      missingCoincidentNet: false,
      bothCoincidentNets: true,
      explicitPairs: true,
    })
  }

  // expanded portfolio reports failed native bounds eligibility without reading uninitialized routes
  {
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: "rounded-boundary",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "net", x: -1, y: 0, z: 0 },
        { connectionName: "net", x: 1 + 2e-7, y: 0, z: 0 },
      ],
    }
    const originalNode = structuredClone(nodeWithPortPoints)
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints,
    })
    portfolio.initializeSolvers()
    portfolio.adaptiveSearchExpanded = true
    const nativeCandidates = portfolio.supervisedSolvers!.filter(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A11,
    )
    expect(nativeCandidates).toHaveLength(1)
    expect(portfolio.stats.dynamicExpansionWorkBudget).toBe(
      Math.max(
        1,
        ...portfolio.supervisedSolvers!
          .filter(({ solver }) => !solver.failed)
          .map(({ solver }) => solver.MAX_ITERATIONS),
      ),
    )
    for (const { solver } of nativeCandidates) {
      solver.step()
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
      expect(solver.error).toContain("outside original node bounds")
      expect(portfolio.computeH(solver)).toBe(1)
      expect(portfolio.getSupervisedSolverWithBestFitness()?.solver).not.toBe(
        solver,
      )
    }
    expect(nodeWithPortPoints).toEqual(originalNode)
    expect(portfolio.solvedRoutes).toEqual([])
  }

  // a native candidate cannot silently continue after returning invalid solved output
  {
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        {
          connectionName: "net",
          rootConnectionName: "root",
          x: -1,
          y: 0,
          z: 0,
        },
        { connectionName: "net", rootConnectionName: "root", x: 1, y: 0, z: 0 },
      ],
    }
    const solver = new HighDensitySolverA11({
      nodeWithPortPoints,
      viaDiameter: 0.3,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const validRoutes = solver.getOutput()
    const outputSpy = spyOn(solver, "getOutput").mockReturnValue([])
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints,
    })

    expect(() =>
      portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
    ).toThrow("physical port-point pairs are not covered exactly once")
    expect(portfolio.solvedRoutes).toEqual([])
    outputSpy.mockReturnValue(
      validRoutes.map((route) => ({
        ...route,
        rootConnectionName: "wrong-root",
      })),
    )
    expect(() =>
      portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
    ).toThrow("physical port-point pairs are not covered exactly once")
    expect(portfolio.solvedRoutes).toEqual([])
    for (const invalidPoint of [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 0, y: 0, z: 0.5 },
      { x: 0, y: 0, z: 10 },
    ]) {
      const invalidRoutes = structuredClone(validRoutes)
      invalidRoutes[0]!.route.splice(1, 0, invalidPoint)
      outputSpy.mockReturnValue(invalidRoutes)
      expect(() =>
        portfolio.onSolve({ solver, hyperParameters: {}, h: 0, g: 0, f: 0 }),
      ).toThrow("non-finite, out-of-bounds, or unavailable-layer route point")
      expect(portfolio.solvedRoutes).toEqual([])
    }
    outputSpy.mockRestore()
  }

  // native grids retain unique same-root pairs without changing legacy alias repair
  {
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: ["branch-a", "branch-b"].flatMap((connectionName) =>
        [-1, 1].map((x) => ({
          connectionName,
          rootConnectionName: "root",
          x,
          y: 0,
          z: 0,
        })),
      ),
    }
    for (const { hyperParameters, expectedRouteCount } of [
      { hyperParameters: { HIGH_DENSITY_A11: true }, expectedRouteCount: 1 },
      { hyperParameters: { HIGH_DENSITY_A01: true }, expectedRouteCount: 2 },
      { hyperParameters: { HIGH_DENSITY_A03: true }, expectedRouteCount: 2 },
    ]) {
      const portfolio = new PortfolioSingleIntraNodeSolver({
        nodeWithPortPoints,
      })
      const solver = portfolio.generateSolver(hyperParameters)
      solver.solve()
      expect(solver.solved).toBe(true)

      portfolio.onSolve({ solver, hyperParameters, h: 0, g: 0, f: 0 })
      expect(portfolio.solvedRoutes).toHaveLength(expectedRouteCount)
      expect(
        doRoutesCoverNodePortPointPairsExactlyOnce(
          portfolio.solvedRoutes,
          nodeWithPortPoints,
        ),
      ).toBe(expectedRouteCount === 1)
    }
  }

  // Pipeline9 aggregates grow/shrink attempts from regular node solvers
  {
    const connMap = new ConnectivityMap({})
    const solver = new TestPipeline9HighDensitySolver({
      nodePortPoints: [],
      fixedHdRoutes: [],
      connMap,
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.5,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
    })
    const regularSolver = new HighDensitySolver({
      nodePortPoints: [],
      connMap,
      useGrowShrinkHighDensityIntraNodeSolver: true,
    })
    regularSolver.stats.highDensityResizeCount = 3
    solver.activeRegularSolver = regularSolver

    solver.finishRegularNode()

    expect(solver.stats.highDensityResizeCount).toBe(3)

    const regionalSolver = new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "regional-node",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
        portPoints: [],
        portPointsInPairs: [],
      },
      colorMap: {},
      connMap,
      viaDiameter: 0.5,
      traceWidth: 0.15,
      obstacleMargin: 0.15,
      effort: 1,
      obstacles: [],
      layerCount: 2,
    })
    regionalSolver.highDensitySolver.stats.highDensityResizeCount = 2
    regionalSolver.failed = true
    solver.activeFallbackSolver = regionalSolver

    solver.step()

    expect(solver.stats.highDensityResizeCount).toBe(5)
  }

  // joint repair supplies independent reference validation to its candidate portfolio
  {
    const routes: HighDensityRoute[] = [0, 1, 2].map((index) => ({
      connectionName: `net${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        {
          x: -1,
          y: index === 2 ? 1 : index * 0.15,
          z: 0,
          pcb_port_id: `net${index}_0`,
        },
        {
          x: 1,
          y: index === 2 ? 1 : index * 0.15,
          z: 0,
          pcb_port_id: `net${index}_1`,
        },
      ],
      vias: [],
    }))
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [],
      connections: routes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: route.route.map((point, index) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pointId: `${route.connectionName}_${index}`,
          pcb_port_id: point.pcb_port_id,
        })),
      })),
    }
    const solver = new Pipeline9JointDrcRepairSolver({
      srj,
      srjWithPointPairs: srj,
      originalSrj: srj,
      newConnections: srj.connections,
      newHdRoutes: routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: srj.obstacles,
      layerCount: 2,
      defaultViaDiameter: 0.3,
      defaultViaHoleDiameter: 0.15,
      effort: 1,
      colorMap: {},
    })
    const reference = solver.exactRepairSolver!.params.referenceDrcEvaluator
    expect(reference).toBeDefined()
    if (!reference) throw new Error("Joint repair needs reference validation")
    expect(reference).not.toBe(solver.exactRepairSolver!.params.drcEvaluator)
    const initial = reference({ traces: [], routes })
    const changedRoutes = structuredClone(routes)
    // Preserve the third route's terminals while adding a clearance violation.
    changedRoutes[2]!.route.splice(1, 0, { x: 0, y: 0.3, z: 0 })
    const changed = reference({ traces: [], routes: changedRoutes })
    const initialErrors = Array.isArray(initial) ? initial : initial.errors
    const changedErrors = Array.isArray(changed) ? changed : changed.errors
    expect(initialErrors).toHaveLength(1)
    expect(changedErrors.length).toBeGreaterThan(initialErrors.length)
  }
})
