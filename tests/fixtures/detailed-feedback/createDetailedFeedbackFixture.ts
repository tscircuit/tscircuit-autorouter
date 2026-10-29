import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams, RegionHg, RegionPortHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { DetailedFeedbackParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedFeedbackSolver"

/** Nine empty rectangles and two crossing nets; no dataset/board fixture. */
export const createDetailedFeedbackFixture = (
  beforeMasterSolve?: (solver: TinyHypergraphPortPointPathingSolver) => void,
): DetailedFeedbackParams => {
  const regions: RegionHg[] = []
  const ports: RegionPortHg[] = []
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const regionId = `${x}:${y}`
    regions.push({ regionId, ports: [], d: { capacityMeshNodeId: regionId,
      center: { x: x * 8, y: y * 8 }, width: 8, height: 8, layer: "z0", availableZ: [0, 1] } })
  }
  for (const left of regions) for (const right of regions) {
    const dx = right.d.center.x - left.d.center.x
    const dy = right.d.center.y - left.d.center.y
    if (!((dx === 8 && dy === 0) || (dy === 8 && dx === 0))) continue
    const portId = `${left.regionId}->${right.regionId}`
    const port: RegionPortHg = { portId, region1: left, region2: right,
      d: { portId, x: (left.d.center.x + right.d.center.x) / 2,
        y: (left.d.center.y + right.d.center.y) / 2, z: 0,
        distToCentermostPortOnZ: 0, regions: [left, right] } }
    ports.push(port); left.ports.push(port); right.ports.push(port)
  }
  const pairs = [["horizontal", "-1:0", "1:0"], ["vertical", "0:-1", "0:1"]]
  const connections = pairs.map(([connectionId, startId, endId]) => {
    const startRegion = regions.find((region) => region.regionId === startId)!
    const endRegion = regions.find((region) => region.regionId === endId)!
    return { connectionId: connectionId!, mutuallyConnectedNetworkId: connectionId!, startRegion, endRegion,
      simpleRouteConnection: { name: connectionId!, pointsToConnect: [
        { ...startRegion.d.center, layer: "top" }, { ...endRegion.d.center, layer: "top" }] } }
  })
  const weights: HgPortPointPathingSolverParams["weights"] = {
    SHUFFLE_SEED: 0, CENTER_OFFSET_DIST_PENALTY_FACTOR: 0, CENTER_OFFSET_FOCUS_SHIFT: 0,
    GREEDY_MULTIPLIER: 1, NODE_PF_FACTOR: 0, LAYER_CHANGE_COST: 0, RIPPING_PF_COST: 0,
    NODE_PF_MAX_PENALTY: 100, MEMORY_PF_FACTOR: 0, BASE_CANDIDATE_COST: 0.5,
    MIN_ALLOWED_BOARD_SCORE: -10000, MAX_ITERATIONS_PER_PATH: 0, RANDOM_WALK_DISTANCE: 0,
    START_RIPPING_PF_THRESHOLD: 0.3, END_RIPPING_PF_THRESHOLD: 1, MAX_RIPS: 0,
    RANDOM_RIP_FRACTION: 0, STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
  }
  const initialPathingSolver = new TinyHypergraphPortPointPathingSolver({ graph: { regions, ports },
    connections, layerCount: 2, effort: 1, preserveTerminalPcbPortIds: true,
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true }, weights })
  beforeMasterSolve?.(initialPathingSolver)
  initialPathingSolver.solve()
  if (initialPathingSolver.failed) throw new Error(initialPathingSolver.error!)
  const output = initialPathingSolver.getOutput()
  const distributionParams = { obstacles: [], layerCount: 2, useLayerAwareGeometry: false, preserveSolitaryPorts: false }
  const initialDistributionSolver = new UniformPortDistributionSolver({ ...distributionParams,
    nodeWithPortPoints: output.nodesWithPortPoints, inputNodesWithPortPoints: output.inputNodeWithPortPoints })
  initialDistributionSolver.solve()
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["horizontal"], ["vertical"]])
  return { initialPathingSolver, initialDistributionSolver, distributionParams,
    highDensityParams: { fixedHdRoutes: [], connMap, obstacles: [], layerCount: 2,
      viaDiameter: 0.6, traceWidth: 0.15, obstacleMargin: 0.1, effort: 1,
      enableRegionalFallback: false, preserveTerminalPcbPortIds: true }, probeStepsPerNode: 32 }
}
