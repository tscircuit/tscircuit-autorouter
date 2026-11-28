import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { BidirectionalStallPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/BidirectionalStallPreparedPortPointRoutingSolver"

function createSealedPocketReripFixture(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
} {
  const regionIncidentPorts: number[][] = []
  const incidentPortRegion: number[][] = []
  const regionCenterX: number[] = []
  const regionCenterY: number[] = []
  const regionAvailableZMask: number[] = []
  const portX: number[] = []
  const portY: number[] = []
  const portZ: number[] = []

  const addRegion = (cx: number, cy: number, zMask: number): number => {
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

  // Open 60x45 mesh attached north of the single-layer gate region.
  const cols = 60
  const rows = 45
  const gridRegion = (col: number, row: number): number => row * cols + col
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      addRegion(col * 2, row * 2 + 2, 1)
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const r = gridRegion(col, row)
      if (col + 1 < cols) {
        addPort(col * 2 + 1, row * 2 + 2, 0, [r, gridRegion(col + 1, row)])
      }
      if (row + 1 < rows) {
        addPort(col * 2, row * 2 + 3, 0, [r, gridRegion(col, row + 1)])
      }
    }
  }

  // Single-layer gate region M at (0, 0):
  // - Route 0 crosses West (-1, 0) <-> East (1, 0) first, sealing off the South pocket.
  // - Route 1 connects from the open mesh (North) into the sealed South pocket.
  // - A longer south-around bypass lets Route 0 reroute cleanly once selectively ripped.
  const gateRegion = addRegion(0, 0, 1)
  const leftRegion = addRegion(-2, 0, 1)
  const rightRegion = addRegion(2, 0, 1)
  const pocketRegion = addRegion(0, -2, 1)
  const bypassWestRegion = addRegion(-2, -4, 1)
  const bypassMidRegion = addRegion(0, -4, 1)
  const bypassEastRegion = addRegion(2, -4, 1)

  addPort(0, 1, 0, [gateRegion, gridRegion(0, 0)])
  addPort(0, -1, 0, [gateRegion, pocketRegion])
  addPort(-1, 0, 0, [gateRegion, leftRegion])
  addPort(1, 0, 0, [gateRegion, rightRegion])

  addPort(-2, -1, 0, [leftRegion, bypassWestRegion])
  addPort(-1, -4, 0, [bypassWestRegion, bypassMidRegion])
  addPort(1, -4, 0, [bypassMidRegion, bypassEastRegion])
  addPort(2, -1, 0, [bypassEastRegion, rightRegion])

  const start0 = addPort(-2.6, 0, 0, [leftRegion])
  const end0 = addPort(2.6, 0, 0, [rightRegion])
  const start1 = addPort(2, 2, 0, [gridRegion(1, 0)])
  const end1 = addPort(0, -2.6, 0, [pocketRegion])

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

  const topology: TinyHyperGraphTopology = {
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
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    routeStartPort: Int32Array.from([start0, start1]),
    routeEndPort: Int32Array.from([end0, end1]),
    routeNet: Int32Array.from([0, 1]),
    portSectionMask: new Int8Array(topology.portCount).fill(1),
    regionNetId: new Int32Array(topology.regionCount).fill(-1),
  }

  const options: TinyHyperGraphSolverOptions = {
    DISTANCE_TO_COST: 0.05,
    MAX_ITERATIONS: 8_000,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    USE_SPARSE_CANDIDATE_STORAGE: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  }

  return { topology, problem, options }
}

test("bidirectional stall solver detects dynamically sealed pockets early and flips blocker search outward from the pocket", (): void => {
  const { topology, problem, options } = createSealedPocketReripFixture()

  // Unidirectional search floods the 60x45 mesh and exhausts 8k iterations before detecting the seal.
  const baseline = new PreparedPortPointRoutingSolver(
    topology,
    problem,
    options,
  )
  baseline.solve()
  expect(baseline.solved).toBe(false)

  // Bidirectional stall search empties the reverse pocket in a few steps, flips
  // relaxed blocker search outward from the pocket, rips Route 0, and solves both.
  const solver = new BidirectionalStallPreparedPortPointRoutingSolver(
    topology,
    problem,
    options,
  )
  expect(solver.BIDIRECTIONAL_STALL_THRESHOLD).toBe(10_000)
  solver.BIDIRECTIONAL_STALL_THRESHOLD = 2_000
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBeLessThan(3_000)

  const stallStats = solver.getBidirectionalStallStats()
  expect(stallStats.triggerCount).toBe(1)
  expect(stallStats.disconnectedCount).toBe(1)
  expect(stallStats.reverseBlockerFlipCount).toBe(1)

  const reripStats = solver.getSelectiveReripStats()
  expect(reripStats.selectiveRipCount).toBe(1)
  expect(reripStats.lastRippedRouteIds).toEqual([0])
  expect(reripStats.lastRelaxedSearchExpandedLabelCount).toBeLessThan(100)
})
