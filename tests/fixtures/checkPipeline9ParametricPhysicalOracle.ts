import { expect } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { normalizePipeline9NodeRootConnectionNames } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { constructPipeline9ParametricCellOracle } from "./pipeline9ParametricCellOracle"

export async function checkPipeline9ParametricPhysicalOracle(sampleNumber: number): Promise<{
  checkedCells: number; compiledCells: number; cacheHits: number; preparedObstacles: number; rejectedObstacles: number
}> {
  const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber)
  expect(scenario.traces?.length ?? 0).toBe(0)
  const solver = new Pipeline(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  expect(evaluateRelaxedDrc({ inputSrj: output, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: [], includeBoardClearance: true }).errors).toEqual([])
  const hd = solver.highDensityRouteSolver!
  const traceWidthByConnection = Object.fromEntries(solver.srjWithPointPairs!.connections.map((connection) => [connection.name, Math.max(solver.minTraceWidth, connection.nominalTraceWidth ?? solver.minTraceWidth)]))
  const result = { checkedCells: 0, compiledCells: 0, cacheHits: 0, preparedObstacles: 0, rejectedObstacles: 0 }
  for (const node of solver.highDensityNodePortPoints!) {
    const params = { node: normalizePipeline9NodeRootConnectionNames(node, hd.connMap), connMap: hd.connMap, obstacles: hd.obstacles,
      boardGeometry: hd.boardGeometry, layerCount: hd.layerCount, traceWidth: hd.traceWidth, traceWidthByConnection,
      traceToPadClearance: scenario.minTraceToPadEdgeClearance, traceToHoleClearance: scenario.minTraceToHoleEdgeClearance,
      viaToPadClearance: hd.viaToPadClearance, viaDiameter: hd.viaDiameter, obstacleMargin: hd.obstacleMargin, allowBlindAndBuriedVias: hd.allowBlindAndBuriedVias }
    const original = constructPipeline9ParametricCellOracle(params)
    const prepared = constructPipeline9ParametricCell(params)
    expect(prepared.applicable).toBe(original.applicable)
    expect(prepared.routes).toEqual(original.routes)
    for (const [key, value] of Object.entries(original.stats)) expect(prepared.stats[key as keyof typeof prepared.stats]).toBe(value)
    result.checkedCells++
    result.compiledCells += Number(prepared.applicable)
    result.cacheHits += prepared.stats.parametricPairConflictCacheHits
    result.preparedObstacles += prepared.stats.parametricSetupObstacleCount
    result.rejectedObstacles += prepared.stats.parametricObstacleBroadphaseRejected
  }
  console.log("Exact parametric physical oracle", sampleNumber, JSON.stringify(result))
  return result
}
