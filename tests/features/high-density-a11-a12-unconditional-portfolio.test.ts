import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import {
  HighDensitySolverA11,
  HighDensitySolverA12,
} from "lib/solvers/HighDensitySolver/official-high-density-a11-a12"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

const solverParams = {
  nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
  viaDiameter: 0.3,
  traceWidth: 0.1,
  obstacleMargin: 0.15,
  obstacles: [],
  layerCount: 2,
  effort: 1,
}

const getExternalCandidates = (portfolio: PortfolioSingleIntraNodeSolver) => {
  if (!portfolio.supervisedSolvers) portfolio.initializeSolvers()

  const externalCandidates = portfolio.supervisedSolvers!.filter(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 ||
      hyperParameters.HIGH_DENSITY_A03 ||
      hyperParameters.HIGH_DENSITY_A12 ||
      hyperParameters.HIGH_DENSITY_A11,
  )
  expect(
    externalCandidates.map(({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01
        ? "A01"
        : hyperParameters.HIGH_DENSITY_A03
          ? "A03"
          : hyperParameters.HIGH_DENSITY_A12
            ? "A12"
            : "A11",
    ),
  ).toEqual(["A12", "A11", "A01", "A03"])

  return {
    a12Candidate: externalCandidates.find(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A12,
    )!,
    a11Candidate: externalCandidates.find(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A11,
    )!,
  }
}

const getPipelinePortfolio = (highDensitySolver: HighDensitySolver) => {
  highDensitySolver.step()
  expect(highDensitySolver.activeSubSolver).toBeInstanceOf(
    GrowShrinkHighDensityIntraNodeSolver,
  )

  const growShrinkSolver =
    highDensitySolver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  growShrinkSolver.step()
  expect(growShrinkSolver.activeSubSolver).toBeInstanceOf(
    PortfolioSingleIntraNodeSolver,
  )

  return growShrinkSolver.activeSubSolver!
}

test("Pipeline7 and Pipeline9 always run A11 and A12 alongside existing high-density candidates", () => {
  const pipeline7 = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)
  const pipeline7HighDensityStep = pipeline7.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )!
  const [pipeline7HighDensityParams] =
    pipeline7HighDensityStep.getConstructorParams({
      ...pipeline7,
      uniformPortDistributionSolver: { getOutput: () => [] } as any,
      portPointPathingSolver: {
        getOutput: () => ({
          nodesWithPortPoints: [sample002LargeNode],
          inputNodeWithPortPoints: [sample002LargeNode],
        }),
        computeNodePf: () => null,
      } as any,
    } as any)
  expect(
    (pipeline7HighDensityParams as any).useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
  getExternalCandidates(
    getPipelinePortfolio(
      new HighDensitySolver(pipeline7HighDensityParams as any),
    ),
  )

  const pipeline9HighDensitySolver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: {
      [sample002LargeNode.capacityMeshNodeId]: null,
    },
    obstacles: [],
    layerCount: 2,
  })
  expect(
    pipeline9HighDensitySolver.useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
  getExternalCandidates(getPipelinePortfolio(pipeline9HighDensitySolver))

  const a12Portfolio = new PortfolioSingleIntraNodeSolver(solverParams)
  const { a12Candidate, a11Candidate } = getExternalCandidates(a12Portfolio)

  expect(a12Candidate.solver).toBeInstanceOf(HighDensitySolverA12)
  expect(a11Candidate.solver).toBeInstanceOf(HighDensitySolverA11)
  expect((a12Candidate.solver as any).highResolutionCellSize).toBe(0.05)
  expect((a12Candidate.solver as any).lowResolutionCellSize).toBe(0.2)
  expect((a12Candidate.solver as any).highResolutionCellThickness).toBe(16)
  expect((a11Candidate.solver as any).cellSizeMm).toBe(0.05)
  for (const { solver } of a12Portfolio.supervisedSolvers!) {
    if (solver !== a12Candidate.solver) solver.failed = true
  }
  a12Portfolio.step()
  expect(a12Candidate.solver.iterations).toBeGreaterThan(0)

  const a11Portfolio = new PortfolioSingleIntraNodeSolver(solverParams)
  const { a11Candidate: runnableA11Candidate } =
    getExternalCandidates(a11Portfolio)
  for (const { solver } of a11Portfolio.supervisedSolvers!) {
    if (solver !== runnableA11Candidate.solver) solver.failed = true
  }
  a11Portfolio.step()
  expect(runnableA11Candidate.solver.iterations).toBeGreaterThan(0)

  const grownRetry = new GrowShrinkHighDensityIntraNodeSolver({
    ...solverParams,
    maxGrowthAttempts: 1,
  })
  grownRetry.activeSubSolver = {
    failed: true,
    solved: false,
    error: "forced native-size failure",
    solvedRoutes: [],
    step() {},
  } as any
  grownRetry.step()
  expect(grownRetry.scaleFactor).toBe(2)
  grownRetry.step()
  expect(grownRetry.activeSubSolver).toBeInstanceOf(
    PortfolioSingleIntraNodeSolver,
  )
  expect(grownRetry.activeSubSolver!.nodeWithPortPoints.width).toBe(
    sample002LargeNode.width * 2,
  )
  getExternalCandidates(grownRetry.activeSubSolver!)
})
