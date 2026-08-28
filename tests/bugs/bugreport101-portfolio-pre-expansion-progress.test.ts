import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { PortPoint } from "lib/types/high-density-types"

test("bugreport101 portfolio prioritizes solved segment progress before adaptive expansion", () => {
  const portPointsInPairs: [PortPoint, PortPoint][] = Array.from(
    { length: 4 },
    (_, index) => [
      {
        connectionName: `connection-${index}`,
        x: -1,
        y: index,
        z: 0,
      },
      {
        connectionName: `connection-${index}`,
        x: 1,
        y: index,
        z: 0,
      },
    ],
  )
  const solver = new PortfolioSingleIntraNodeSolver({
    prioritizeSolvedSegmentProgressBeforeAdaptiveExpansion: true,
    nodeWithPortPoints: {
      capacityMeshNodeId: "bugreport101-progress-node",
      center: { x: 0, y: 1.5 },
      width: 2,
      height: 3,
      portPoints: portPointsInPairs.flat(),
      portPointsInPairs,
    },
  })
  solver.MIN_SUBSTEPS = 1

  const makeCandidate = (solvedSegmentCount: number) => ({
    iterations: 100,
    MAX_ITERATIONS: 1_000,
    progress: 0,
    solved: false,
    failed: false,
    error: null,
    hyperParameters: {},
    solvedConnectionsMap: new Map([
      ["connection", Array.from({ length: solvedSegmentCount }, () => ({}))],
    ]),
    step() {
      this.iterations++
    },
  })
  const laggingCandidate = makeCandidate(1)
  const leadingCandidate = makeCandidate(3)
  const supervise = (candidate: ReturnType<typeof makeCandidate>) => {
    const g = solver.computeG(candidate as any)
    const h = solver.computeH(candidate as any)
    return {
      solver: candidate,
      hyperParameters: {},
      g,
      h,
      f: solver.computeF(g, h),
    }
  }
  solver.supervisedSolvers = [
    supervise(laggingCandidate),
    supervise(leadingCandidate),
  ] as any
  const selectBestSolver =
    solver.getSupervisedSolverWithBestFitness.bind(solver)
  let selectionCount = 0
  solver.getSupervisedSolverWithBestFitness = () => {
    selectionCount++
    return selectBestSolver()
  }

  expect(solver.adaptiveSearchExpanded).toBe(false)
  expect(laggingCandidate.progress).toBe(0)
  expect(leadingCandidate.progress).toBe(0)
  expect(solver.computeH(laggingCandidate as any)).toBe(0.75)
  expect(solver.computeH(leadingCandidate as any)).toBe(0.25)

  solver.step()

  expect(laggingCandidate.iterations).toBe(100)
  expect(leadingCandidate.iterations).toBe(101)
  expect(solver.activeSubSolver).toBe(leadingCandidate as any)
  expect(solver.adaptiveSearchExpanded).toBe(false)
  expect(selectionCount).toBe(1)

  const multipointPortPoints: PortPoint[] = [
    { connectionName: "multipoint", x: -1, y: 0, z: 0 },
    { connectionName: "multipoint", x: 0, y: 0, z: 0 },
    { connectionName: "multipoint", x: 1, y: 0, z: 0 },
  ]
  const oneOfTwoSegments = makeCandidate(1)
  const pairVariants: Array<[PortPoint, PortPoint][] | undefined> = [
    undefined,
    [],
  ]
  for (const portPointsInPairs of pairVariants) {
    const multipointSolver = new PortfolioSingleIntraNodeSolver({
      prioritizeSolvedSegmentProgressBeforeAdaptiveExpansion: true,
      nodeWithPortPoints: {
        capacityMeshNodeId: "bugreport101-multipoint-progress-node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 1,
        portPoints: multipointPortPoints,
        portPointsInPairs,
      },
    })
    expect(multipointSolver.computeH(oneOfTwoSegments as any)).toBe(0.5)
    expect((multipointSolver as any).nodeSegmentCount).toBe(2)
    expect(multipointSolver.computeH(oneOfTwoSegments as any)).toBe(0.5)
  }
})
