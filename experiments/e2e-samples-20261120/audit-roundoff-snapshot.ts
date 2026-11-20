import { mkdirSync, writeFileSync } from "node:fs"
import { evaluateRelaxedDrc, type EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
export function captureRoundoffRouting(solver: AutoroutingPipelineSolver9_PreloadedTraceGraph, auditInput: EvaluateRelaxedDrcInput): void {
  const result = evaluateRelaxedDrc(auditInput)
  const counts: Record<string, number> = {}
  for (const error of result.errors) counts[error.type] = (counts[error.type] ?? 0) + 1
  const traces = result.circuitJson.filter((element) => element.type === "pcb_trace")
  const vias = result.circuitJson.filter((element) => element.type === "pcb_via")
  const report = { solved: solver.solved, failed: solver.failed, requestedConnections: solver.originalSrj.connections.length, traces: traces.length, vias: vias.length, drcFindings: result.errors.length, drcTypes: counts }
  mkdirSync("snapshot-audit", { recursive: true })
  writeFileSync("snapshot-audit/assessment.json", JSON.stringify(report, null, 2))
  writeFileSync("snapshot-audit/circuit.json.gz", Bun.gzipSync(JSON.stringify(result.circuitJson)))
  writeFileSync("snapshot-audit/errors.json.gz", Bun.gzipSync(JSON.stringify(result.errors)))
  console.log("ROUNDOFF_SNAPSHOT_ASSESSMENT", JSON.stringify(report))
}
