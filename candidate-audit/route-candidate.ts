import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from '../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph'
import { evaluateRelaxedDrc, combinePreloadedAndRoutedTraces } from '../lib/testing/evaluate-relaxed-drc'
import { migrateLegacyObstacleCircuitJsonMetadata } from '../lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata'
import type { SimpleRouteJson } from '../lib/types'

const [inputPath, outputPath] = process.argv.slice(2)
const originalInput: SimpleRouteJson = await Bun.file(inputPath).json()
const start = performance.now()
let result: Record<string, unknown>
try {
  const effectiveInput = migrateLegacyObstacleCircuitJsonMetadata(structuredClone(originalInput))
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(effectiveInput), { effort: 1 })
  solver.solve()
  result = { solved: solver.solved, failed: solver.failed, error: solver.error, iterations: solver.iterations, status: 'routing-failed' }
  if (solver.solved && !solver.failed) {
    const traces = solver.getOutputSimplifiedPcbTraces()
    const pointPairs = solver.srjWithPointPairs
    if (!pointPairs) throw new Error('Solved without point-pair SRJ')
    const drc = evaluateRelaxedDrc({ inputSrj: effectiveInput, srjWithPointPairs: pointPairs, routedTraces: traces })
    const qualifies = traces.length > 0 && drc.errors.length > 0
    result = { ...result, status: qualifies ? 'qualifies' : 'drc-passed', traceCount: traces.length, drcErrorCount: drc.errors.length }
    if (true) {
      result = { ...result, errors: drc.errors, circuitJson: drc.circuitJson, effectiveInputSrj: effectiveInput,
        routedSrj: { ...originalInput, traces: combinePreloadedAndRoutedTraces(originalInput.traces ?? [], traces) },
        pointPairSrj: pointPairs, routedTraces: traces }
    }
  }
} catch (error) {
  result = { solved: false, failed: true, status: 'error', error: String(error), stack: (error as Error).stack }
}
result.durationMs = performance.now() - start
await Bun.write(outputPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ inputPath, status: result.status, drcErrorCount: result.drcErrorCount, durationMs: result.durationMs }))
