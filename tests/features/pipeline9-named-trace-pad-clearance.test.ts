import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("P9 forwards authoritative pad edge clearance without changing hole, via or generic margins", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "legal-near-pad", center: { x: 0, y: 0 }, width: 2, height: 2,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7], portPoints: [
      { x: 0.445, y: 0, z: 1, connectionName: "signal" },
      { x: -0.8, y: 0.5, z: 5, connectionName: "signal" },
    ],
  }
  const pad: Obstacle = { type: "rect", center: { x: 1.1, y: 0 }, width: 1,
    height: 2, layers: ["inner1"], connectedTo: ["foreign-pad"],
    circuitJsonMetadata: { pcb_smtpad_id: "foreign-pad" } }
  const createPortfolio = (clearance?: number): PortfolioSingleIntraNodeSolver => {
    const srj: SimpleRouteJson = { layerCount: 8, minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: clearance, obstacles: [pad], connections: [],
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } }
    const pipeline = new Pipeline9(srj)
    pipeline.connMap = new ConnectivityMap({ signal: ["signal"], other: ["foreign-pad"] })
    pipeline.portPointPathingSolver = { getOutput: () => ({ nodesWithPortPoints: [structuredClone(node)],
      changedPreloadedTraceSections: [] }), computeNodePfMap: () => new Map() } as any
    const step = pipeline.pipelineDef.find((stage) => stage.solverName === "highDensityRouteSolver")!
    const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensitySolver>
    expect(params.traceToPadClearance).toBe(clearance ?? 0.1)
    expect(params.obstacleMargin).toBe(0.15)
    const outer = new Pipeline9HighDensitySolver(params)
    ;(outer as any).startRegularSolver(structuredClone(node))
    const regular = outer.activeRegularSolver!
    expect(regular.traceToPadClearance).toBe(clearance ?? 0.1)
    regular.step()
    const grow = regular.activeSubSolver as any
    expect(grow.constructorParams.traceToPadClearance).toBe(clearance ?? 0.1)
    grow.createActiveSubSolver()
    return grow.activeSubSolver as PortfolioSingleIntraNodeSolver
  }
  const defaultPortfolio = createPortfolio()
  const solve = (portfolio: PortfolioSingleIntraNodeSolver) =>
    portfolio.generateSolver({ CLOSED_FORM_SINGLE_TRANSITION: true })
  const defaultRoute = solve(defaultPortfolio)
  expect(defaultRoute.solved).toBe(true)
  // Center-to-pad .155 leaves .105 copper edge clearance, above the raw .1 rule.
  expect(1.1 - 0.5 - 0.445 - 0.05).toBeCloseTo(0.105, 12)
  expect(defaultPortfolio.constructorParams.obstacleMargin).toBe(0.15)
  expect(defaultPortfolio.constructorParams.viaToPadClearance).toBeUndefined()
  const legacy = new PortfolioSingleIntraNodeSolver({ ...defaultPortfolio.constructorParams,
    traceToPadClearance: undefined })
  expect(solve(legacy).failed).toBe(true)
  expect(solve(createPortfolio(0)).solved).toBe(true)
  expect(solve(createPortfolio(0.2)).failed).toBe(true)

  const hole = new PortfolioSingleIntraNodeSolver({ ...defaultPortfolio.constructorParams,
    obstacles: [{ ...pad, connectedTo: [], circuitJsonMetadata: undefined, isNonPlatedHole: true }] })
  expect(solve(hole).failed).toBe(true)
  const opaque = new PortfolioSingleIntraNodeSolver({ ...defaultPortfolio.constructorParams,
    traceToPadClearance: 0.2, obstacles: [{ ...pad, connectedTo: [], circuitJsonMetadata: undefined }] })
  expect(solve(opaque).solved).toBe(true)
  const regional = new Pipeline9RegionalFallbackSolver({ nodeWithPortPoints: node, colorMap: {},
    connMap: defaultPortfolio.connMap!, viaDiameter: 0.3, traceWidth: 0.1,
    obstacleMargin: 0.15, traceToPadClearance: 0.1, viaToPadClearance: 0.25,
    effort: 1, obstacles: [pad], layerCount: 8 })
  expect(regional.highDensitySolver.traceToPadClearance).toBe(0.1)
  expect(regional.highDensitySolver.obstacleMargin).toBe(0.15)
  expect(regional.highDensitySolver.viaToPadClearance).toBe(0.25)
})
