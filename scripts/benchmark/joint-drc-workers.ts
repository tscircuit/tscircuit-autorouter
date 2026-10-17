import { writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { NodePipeline9RepairRuntime } from "../../lib/autorouter-pipelines/Pipeline9_Parallel/NodePipeline9RepairRuntime"
import { loadJointDrcInput } from "./utils/loadJointDrcInput"

// bun scripts/benchmark/joint-drc-workers.ts input.json[.gz] [workers=0] [output-prefix]
const params = loadJointDrcInput(process.argv[2]!)
const workers = Number(process.argv[3] ?? 0)
const prefix = process.argv[4] ?? `joint-drc-${workers}-workers`
const runtime = workers > 0 ? new NodePipeline9RepairRuntime(workers) : undefined
const startedAt = performance.now()
try {
  const solver = new Pipeline9JointDrcRepairSolver({ ...params, repairRuntime: runtime })
  const constructionMs = performance.now() - startedAt
  const phases: Record<string, number> = {}
  while (!solver.solved && !solver.failed) {
    const phase = solver.getCurrentPhase(), start = performance.now()
    solver.step()
    phases[phase] = (phases[phase] ?? 0) + performance.now() - start
  }
  const elapsedMs = performance.now() - startedAt
  if (!solver.solved || solver.failed) throw new Error(`Joint repair failed: ${solver.error}`)
  const routes = solver.getOutput()
  const output = JSON.stringify({ routes, preloaded: solver.getUpdatedPreloadedTraces() })
  const result = {
    workers, elapsedMs, constructionMs, phases, routeCount: routes.length,
    viaCount: routes.reduce((count, route): number => count + route.vias.length, 0),
    routeLength: routes.reduce((length, route): number => length + route.route.slice(1).reduce((sum, point, index): number => {
      const previous = route.route[index]!
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0), 0),
    hash: createHash("sha256").update(output).digest("hex"),
    stats: solver.stats,
  }
  writeFileSync(`${prefix}-output.json`, output)
  writeFileSync(`${prefix}-result.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await runtime?.dispose()
}
