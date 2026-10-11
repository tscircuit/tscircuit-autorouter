import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import selected from "../fixtures/parallel-native-a13/selected-prefixes.json"

test("authentic A13 C search matches all 69 native selected prefixes, private arrays and stale heap rows", async (): Promise<void> => {
  let candidates = 0, calls = 0, expansions = 0, privateHeapRows = 0, privateArrays = 0
  for (const source of selected) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", source.sample, 1)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { effort: 1, cacheProvider: null })
    while (pipeline.getCurrentPhase() !== "highDensityRouteSolver" && !pipeline.solved && !pipeline.failed) pipeline.step()
    expect(pipeline.failed).toBe(false)
    const stage = pipeline.pipelineDef.find(entry => entry.solverName === "highDensityRouteSolver")!
    const [input] = stage.getConstructorParams(pipeline)
    const params = input as Pipeline9HighDensitySolverParams
    const result = await new Promise<any>((resolve, reject): void => {
      const worker = new Worker(new URL("../fixtures/parallel-native-a13/worker.ts", import.meta.url).href)
      worker.onmessage = (event: MessageEvent): void => {
        worker.terminate()
        if (event.data.error) reject(new Error(event.data.error))
        else resolve(event.data.result)
      }
      worker.onerror = (event: ErrorEvent): void => { worker.terminate(); reject(new Error(event.message)) }
      worker.postMessage({ rows: source.rows, params: { ...params, connMap: undefined,
        connectivityNetMap: params.connMap.netMap, connectivityIdToNetMap: params.connMap.idToNetMap } })
    })
    expect(result.actualKernel).toBe(true)
    expect(result.cPositiveRunCalls).toBeGreaterThan(0)
    expect(result.cExpansions).toBe(result.expansions)
    console.log(JSON.stringify({ sample: source.sample, ...result }))
    candidates += result.candidates; calls += result.calls; expansions += result.expansions
    privateHeapRows += result.privateHeapRows; privateArrays += result.privateArrays
  }
  expect(candidates).toBe(69)
  expect(calls).toBe(12900)
  expect(expansions).toBe(3809059)
  expect(privateArrays).toBe(51600)
  expect(privateHeapRows).toBe(242338816)
})
