import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type CapturedInput = {
  nodePortPoints: NodeWithPortPoints[]
  connMap: { netMap: ConstructorParameters<typeof ConnectivityMap>[0] }
  layerCount: number
  obstacleMargin: number
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  allowBlindAndBuriedVias?: boolean
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
}
type CapturedWinner = { id: string; routes: HighDensityIntraNodeRoute[] }

const [paramsPath, witnessesPath, iterationsText = "40", outputPath] = process.argv.slice(2)
if (!paramsPath || !witnessesPath) throw new Error("Usage: bun experiments/physical-route-legalization/replay.ts <hd-input.json> <grown-winners.json> [iterations=40] [output.json]")
const maxIterations = Number(iterationsText)
if (!Number.isInteger(maxIterations) || maxIterations < 0) throw new Error("iterations must be a nonnegative integer")
const input = await Bun.file(paramsPath).json() as CapturedInput
const witnesses = await Bun.file(witnessesPath).json() as { nodes: CapturedWinner[] }
const connMap = new ConnectivityMap(input.connMap.netMap)
const results = witnesses.nodes.map((winner) => {
  const node = input.nodePortPoints.find((candidate) => candidate.capacityMeshNodeId === winner.id)
  if (!node) throw new Error(`No physical node input for ${winner.id}`)
  const result = legalizeHighDensityRouteProposal({ ...input, node, routes: winner.routes, connMap,
    clearance: input.obstacleMargin, maxIterations })
  const { routes, ...metrics } = result
  console.log(JSON.stringify({ node: winner.id, ...metrics }))
  return { node: winner.id, ...result }
})
if (outputPath) await Bun.write(outputPath, JSON.stringify({ maxIterations, nodes: results }, null, 2))
