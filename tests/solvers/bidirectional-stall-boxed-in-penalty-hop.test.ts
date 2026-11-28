import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { BidirectionalStallPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/BidirectionalStallPreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

type GridBuilder = {
  addRegion: (cx: number, cy: number, zMask?: number) => number
  addPort: (x: number, y: number, z: number, regionIds: number[]) => number
  buildTopology: () => TinyHyperGraphTopology
}

function createGridBuilder(): GridBuilder {
  const regionIncidentPorts: number[][] = []
  const incidentPortRegion: number[][] = []
  const regionCenterX: number[] = []
  const regionCenterY: number[] = []
  const regionAvailableZMask: number[] = []
  const portX: number[] = []
  const portY: number[] = []
  const portZ: number[] = []

  const addRegion = (cx: number, cy: number, zMask = 3): number => {
    const id = regionIncidentPorts.length
    regionIncidentPorts.push([])
    regionCenterX.push(cx)
    regionCenterY.push(cy)
    regionAvailableZMask.push(zMask)
    return id
  }

  const addPort = (
    x: number,
    y: number,
    z: number,
    regionIds: number[],
  ): number => {
    const id = portX.length
    portX.push(x)
    portY.push(y)
    portZ.push(z)
    incidentPortRegion.push(regionIds)
    for (const regionId of regionIds) {
      regionIncidentPorts[regionId]!.push(id)
    }
    return id
  }

  const computeAngle = (portId: number, slot: number): number => {
    const regionId = incidentPortRegion[portId]![slot]!
    return Math.round(
      (Math.atan2(
        portY[portId]! - regionCenterY[regionId]!,
        portX[portId]! - regionCenterX[regionId]!,
      ) *
        18000) /
        Math.PI,
    )
  }

  const buildTopology = (): TinyHyperGraphTopology => ({
    portCount: portX.length,
    regionCount: regionIncidentPorts.length,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth: new Float64Array(regionIncidentPorts.length).fill(2),
    regionHeight: new Float64Array(regionIncidentPorts.length).fill(2),
    regionCenterX: Float64Array.from(regionCenterX),
    regionCenterY: Float64Array.from(regionCenterY),
    regionAvailableZMask: Int32Array.from(regionAvailableZMask),
    portAngleForRegion1: Int32Array.from(portX, (_, p) => computeAngle(p, 0)),
    portAngleForRegion2: Int32Array.from(portX, (_, p) =>
      incidentPortRegion[p]!.length > 1
        ? computeAngle(p, 1)
        : computeAngle(p, 0),
    ),
    portX: Float64Array.from(portX),
    portY: Float64Array.from(portY),
    portZ: Int32Array.from(portZ),
  })

  return { addRegion, addPort, buildTopology }
}

function createBoxedInPenaltyFixture(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
} {
  const builder = createGridBuilder()
  const cols = 60
  const rows = 45
  const gridRegion = (col: number, row: number): number => row * cols + col

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      builder.addRegion(col * 2, row * 2, 3)
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const r = gridRegion(col, row)
      if (col + 1 < cols) {
        builder.addPort(col * 2 + 1, row * 2, 0, [r, gridRegion(col + 1, row)])
      }
      if (row + 1 < rows) {
        builder.addPort(col * 2, row * 2 + 1, 0, [r, gridRegion(col, row + 1)])
      }
    }
  }

  // Route 0: short hop from open grid (0, 0) into a pocket gated by a 1150-penalty port.
  const start0 = builder.addPort(-0.6, 0, 0, [gridRegion(0, 0)])
  const pocket0 = builder.addRegion(0, -2, 3)
  const bridge0 = builder.addPort(0, -1, 0, [gridRegion(0, 0), pocket0])
  const end0 = builder.addPort(0, -2.6, 0, [pocket0])

  // Route 1: short hop where BOTH endpoints sit inside high-penalty pockets attached to the mesh.
  const pocket1A = builder.addRegion(4, -2, 3)
  const bridge1A = builder.addPort(4, -1, 0, [gridRegion(2, 0), pocket1A])
  const start1 = builder.addPort(4, -2.6, 0, [pocket1A])
  const pocket1B = builder.addRegion(8, -2, 3)
  const bridge1B = builder.addPort(8, -1, 0, [gridRegion(4, 0), pocket1B])
  const end1 = builder.addPort(8, -2.6, 0, [pocket1B])

  const topology = builder.buildTopology()
  const portPenalty = new Float64Array(topology.portCount)
  portPenalty[bridge0] = 1_150
  portPenalty[bridge1A] = 150
  portPenalty[bridge1B] = 1_150

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: Int32Array.from([start0, start1]),
    routeEndPort: Int32Array.from([end0, end1]),
    routeNet: Int32Array.from([0, 1]),
    portSectionMask: new Int8Array(topology.portCount).fill(1),
    regionNetId: new Int32Array(topology.regionCount).fill(-1),
    portPenalty,
  }

  const options: TinyHyperGraphSolverOptions = {
    DISTANCE_TO_COST: 0.05,
    MAX_ITERATIONS: 10_000,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    USE_SPARSE_CANDIDATE_STORAGE: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  }

  return { topology, problem, options }
}

test("bidirectional stall solver solves boxed-in high-penalty hops without flooding the open mesh and keeps normal routes identical", async (): Promise<void> => {
  const { topology, problem, options } = createBoxedInPenaltyFixture()

  // Unidirectional search floods the 60x45 zero-penalty mesh and exhausts 10k iterations.
  const baselineExhausted = new PreparedPortPointRoutingSolver(
    topology,
    problem,
    options,
  )
  baselineExhausted.solve()
  expect(baselineExhausted.solved).toBe(false)

  // Stall-triggered bidirectional search bridges both boxed-in hops well under budget.
  const bidirectional = new BidirectionalStallPreparedPortPointRoutingSolver(
    topology,
    problem,
    options,
  )
  expect(bidirectional.BIDIRECTIONAL_STALL_THRESHOLD).toBe(10_000)
  bidirectional.BIDIRECTIONAL_STALL_THRESHOLD = 2_000
  bidirectional.solve()
  expect(bidirectional.solved).toBe(true)
  expect(bidirectional.failed).toBe(false)
  expect(bidirectional.iterations).toBeLessThan(6_000)

  const stallStats = bidirectional.getBidirectionalStallStats()
  expect(stallStats.triggerCount).toBeGreaterThanOrEqual(2)
  expect(stallStats.solvedCount).toBeGreaterThanOrEqual(2)
  expect(stallStats.disconnectedCount).toBe(0)

  // With a large budget, baseline finds the same optimal route segments.
  const baselineUnbounded = new PreparedPortPointRoutingSolver(
    topology,
    problem,
    {
      ...options,
      MAX_ITERATIONS: 100_000,
    },
  )
  baselineUnbounded.solve()
  expect(baselineUnbounded.solved).toBe(true)
  expect(baselineUnbounded.iterations).toBeGreaterThan(20_000)
  expect(bidirectional.state.regionSegments).toEqual(
    baselineUnbounded.state.regionSegments,
  )

  // Normal routes below the stall threshold stay bit-for-bit identical in serial and worker modes.
  const normalFixture = createPreparedRoutingFixture()
  const baselineNormal = new PreparedPortPointRoutingSolver(
    normalFixture.topology,
    normalFixture.problem,
    normalFixture.options,
  )
  baselineNormal.solve()

  const runtime = new SolverRuntime({
    workerCount: 1,
    workerUrl: new URL("../../lib/runtime/node.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    const bidirectionalNormal =
      new BidirectionalStallPreparedPortPointRoutingSolver(
        normalFixture.topology,
        normalFixture.problem,
        normalFixture.options,
      )
    await bidirectionalNormal.solveAsync(runtime)

    expect(bidirectionalNormal.solved).toBe(true)
    expect(bidirectionalNormal.iterations).toBe(baselineNormal.iterations)
    expect(bidirectionalNormal.state.regionSegments).toEqual(
      baselineNormal.state.regionSegments,
    )
    expect(bidirectionalNormal.state.portAssignment).toEqual(
      baselineNormal.state.portAssignment,
    )
    expect(bidirectionalNormal.getBidirectionalStallStats().triggerCount).toBe(
      0,
    )
  } finally {
    await runtime.dispose()
  }
})
