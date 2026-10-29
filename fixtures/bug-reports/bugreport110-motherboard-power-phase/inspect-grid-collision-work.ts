import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  PowerTraceExpanderSolver,
  SpatialObstacleIndex,
} from "@tscircuit/power-trace-expander"

type IndexInspector = {
  getCollisionCandidates(...args: unknown[]): { candidates: number[] }
  itemCollides(...args: unknown[]): boolean
  getItemCollisionRadius?: (...args: unknown[]) => number | null
}

if (!process.argv[2]) {
  throw new Error("Pass the captured expansion-input.json path")
}
const prototype = SpatialObstacleIndex.prototype as unknown as IndexInspector
const originalCandidates = prototype.getCollisionCandidates
const ruleMethod = prototype.getItemCollisionRadius
  ? "getItemCollisionRadius"
  : "itemCollides"
const originalRules = prototype[ruleMethod]!
const counts = { spatialQueries: 0, candidates: 0, ruleSelections: 0 }
prototype.getCollisionCandidates = function (...args: unknown[]) {
  const result = originalCandidates.apply(this, args)
  counts.spatialQueries++
  counts.candidates += result.candidates.length
  return result
}
// Count equivalent rule-selection work in the original combined predicate
// and the prepared checker's extracted predicate. Timings are measured separately.
Object.defineProperty(prototype, ruleMethod, {
  configurable: true,
  writable: true,
  value: function (...args: unknown[]): boolean | number | null {
    counts.ruleSelections++
    return originalRules.apply(this, args)
  },
})
try {
  const [input, options] = JSON.parse(readFileSync(process.argv[2], "utf8"))
  const solver = new PowerTraceExpanderSolver(input, options)
  solver.solve()
  console.log(JSON.stringify({
    ...counts,
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    outputHash: createHash("sha256")
      .update(JSON.stringify(solver.getOutput()))
      .digest("hex"),
  }))
  if (!solver.solved || solver.failed) process.exitCode = 1
} finally {
  prototype.getCollisionCandidates = originalCandidates
  Object.defineProperty(prototype, ruleMethod, {
    configurable: true,
    writable: true,
    value: originalRules,
  })
}
