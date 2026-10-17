import { createHash } from "node:crypto"
import { Pipeline9JointDrcRepairSolver } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { loadPipeline9JointDrcInput } from "../tests/fixtures/loadPipeline9JointDrcInput"

// Set JOINT_DRC_SOLVER_MODULE to an absolute path containing the baseline
// solver source, beside its original relative imports, to compare revisions.
const Solver: typeof Pipeline9JointDrcRepairSolver = process.env
  .JOINT_DRC_SOLVER_MODULE
  ? (await import(process.env.JOINT_DRC_SOLVER_MODULE))
      .Pipeline9JointDrcRepairSolver
  : Pipeline9JointDrcRepairSolver
const inputPath = process.argv[2]
if (!inputPath) {
  throw new Error(
    "Usage: bun scripts/benchmarkPipeline9JointDrcInput.ts <exported-input.json[.gz]>",
  )
}
const params = loadPipeline9JointDrcInput(inputPath)
const started = performance.now()
const solver = new Solver(params)
const constructed = performance.now()
solver.solve()
const finished = performance.now()
if (!solver.solved || solver.failed)
  throw new Error(solver.error ?? "Joint DRC input did not solve")
const routes = solver.getOutput()
const lengthMm = routes.reduce(
  (total, route) =>
    total +
    route.route
      .slice(1)
      .reduce(
        (length, point, index) =>
          length +
          Math.hypot(
            point.x - route.route[index]!.x,
            point.y - route.route[index]!.y,
          ),
        0,
      ),
  0,
)
console.log(
  JSON.stringify({
    constructorMs: constructed - started,
    solveMs: finished - constructed,
    totalMs: finished - started,
    routeCount: routes.length,
    viaCount: routes.reduce((count, route) => count + route.vias.length, 0),
    lengthMm,
    outputSha256: createHash("sha256")
      .update(JSON.stringify(routes))
      .digest("hex"),
    stats: solver.stats,
  }),
)
