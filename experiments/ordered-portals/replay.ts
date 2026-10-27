import { readFileSync, writeFileSync } from "node:fs"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { coarsenPipeline9OrdinaryNodes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coarsenPipeline9OrdinaryNodes"
import { getConnectionPointLayers } from "../../lib/types/srj-types"
import { mapLayerNameToZ } from "../../lib/utils/mapLayerNameToZ"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { loadScenarioBySampleNumber, parseDatasetName } from "../../scripts/benchmark/scenarios"

const dataset = parseDatasetName(process.argv[3]!)
if (!dataset) throw new Error("Unknown dataset")
const input = await loadScenarioBySampleNumber(dataset, Number(process.argv[4]), 1)
const replay = JSON.parse(readFileSync(process.argv[2]!, "utf8"))
const srj = input.scenario
const widths = new Map<string, number>()
for (const connection of srj.connections) {
  const width = Math.max(srj.minTraceWidth, connection.nominalTraceWidth ?? connection.width ?? srj.nominalTraceWidth ?? srj.minTraceWidth)
  for (const name of [connection.name, connection.rootConnectionName]) if (name) widths.set(name, Math.max(width, widths.get(name) ?? 0))
}
const before = performance.now()
const result = slidePipeline9OrderedPortals({
  nodes: replay.nodes, obstacles: replay.obstacles,
  physicalTerminals: srj.connections.flatMap((connection) => connection.pointsToConnect.flatMap((point) => getConnectionPointLayers(point).map((layer) => ({ x: point.x, y: point.y, z: mapLayerNameToZ(layer, srj.layerCount), connectionName: connection.name, rootConnectionName: connection.rootConnectionName })))),
  layerCount: srj.layerCount, traceWidth: srj.minTraceWidth, traceWidthByConnectionName: widths,
  clearance: srj.defaultObstacleMargin ?? 0.15, minTraceToHoleEdgeClearance: srj.minTraceToHoleEdgeClearance,
  boardGeometry: { bounds: srj.bounds, outline: srj.outline, minBoardEdgeClearance: srj.minBoardEdgeClearance },
  connMap: getConnectivityMapFromSimpleRouteJson({ ...srj, obstacles: replay.obstacles }),
})
const coarsened = coarsenPipeline9OrdinaryNodes({ nodes: result.nodes, hasPreloadedTraces: Boolean(srj.traces?.length),
  physicalTerminals: srj.connections.flatMap((connection) => connection.pointsToConnect.flatMap((point) => getConnectionPointLayers(point).map((layer) => ({ x: point.x, y: point.y, z: mapLayerNameToZ(layer, srj.layerCount) })))),
})
let maxRecordedCoordinateDelta = 0
let changedRecordedPortCount = 0
for (const node of coarsened.nodes) {
  const recorded = replay.highDensityNodes.find((entry: typeof node) => entry.capacityMeshNodeId === node.capacityMeshNodeId)
  if (!recorded) { maxRecordedCoordinateDelta = Infinity; continue }
  for (const point of node.portPoints) {
    const original = recorded.portPoints.find((entry: typeof point) => entry.portPointId === point.portPointId && entry.connectionName === point.connectionName)
    if (!original) { maxRecordedCoordinateDelta = Infinity; continue }
    const delta = Math.hypot(point.x - original.x, point.y - original.y)
    if (delta > 0) changedRecordedPortCount++
    maxRecordedCoordinateDelta = Math.max(maxRecordedCoordinateDelta, delta)
  }
}
const summary = { dataset, sample: Number(process.argv[4]), elapsedMs: performance.now() - before, nodeCount: result.nodes.length, stats: result.stats,
  matchesRecordedHighDensityInput: JSON.stringify(coarsened.nodes) === JSON.stringify(replay.highDensityNodes),
  maxRecordedCoordinateDelta, changedRecordedPortCount,
}
console.log(JSON.stringify(summary))
if (process.argv[5]) writeFileSync(process.argv[5]!, JSON.stringify(summary, null, 2))
