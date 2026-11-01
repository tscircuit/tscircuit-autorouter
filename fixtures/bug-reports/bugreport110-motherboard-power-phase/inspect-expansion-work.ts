import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import {
  ObstacleAwareGridRouteSolver,
  PowerTraceExpanderSolver,
  SpatialObstacleIndex,
} from "@tscircuit/power-trace-expander"

type EndpointInspector = {
  problem: ConstructorParameters<typeof ObstacleAwareGridRouteSolver>[0]
  endpointCollides(point: { x: number; y: number }): boolean
}
type CandidateInspector = {
  items: { layers: string[] }[]
  getCollisionCandidates(
    query: { layer: string },
    layerScoped?: boolean,
  ): { candidates: number[] }
}
const prototype =
  ObstacleAwareGridRouteSolver.prototype as unknown as EndpointInspector
const original = prototype.endpointCollides
const seenByIndex = new WeakMap<object, Set<string>>()
const counts = {
  endpointQueries: 0,
  repeatedEndpointQueries: 0,
  blockedEndpoints: 0,
  blockedGridCells: 0,
}
prototype.endpointCollides = function (point: {
  x: number
  y: number
}): boolean {
  const p = this.problem
  let seen = seenByIndex.get(p.obstacleIndex)
  if (!seen) {
    seen = new Set()
    seenByIndex.set(p.obstacleIndex, seen)
  }
  const key = JSON.stringify([
    point.x,
    point.y,
    p.layer,
    p.traceWidth,
    p.connectionNames,
    p.ignoreTraceIndex,
    p.ignoreRouteRange,
    p.obstacleClearance,
  ])
  counts.endpointQueries++
  if (seen.has(key)) counts.repeatedEndpointQueries++
  seen.add(key)
  const result = original.call(this, point)
  if (result) {
    counts.blockedEndpoints++
    const grid = this as unknown as ObstacleAwareGridRouteSolver
    counts.blockedGridCells += grid.rows * grid.columns
  }
  return result
}
const indexPrototype =
  SpatialObstacleIndex.prototype as unknown as CandidateInspector
const originalCandidates = indexPrototype.getCollisionCandidates
let candidateCount = 0
let foreignLayerCandidateCount = 0
indexPrototype.getCollisionCandidates = function (
  query: { layer: string },
  layerScoped?: boolean,
): { candidates: number[] } {
  const result = originalCandidates.call(this, query, layerScoped)
  candidateCount += result.candidates.length
  for (const index of result.candidates) {
    if (!this.items[index]!.layers.includes(query.layer)) {
      foreignLayerCandidateCount++
    }
  }
  return result
}
try {
  if (!process.argv[2]) {
    throw new Error("Pass the captured expansion-input.json path")
  }
  const [input, options] = JSON.parse(readFileSync(process.argv[2], "utf8"))
  const solver = new PowerTraceExpanderSolver(input, options)
  solver.solve()
  const result = {
    ...counts,
    candidateCount,
    foreignLayerCandidateCount,
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    outputHash: createHash("sha256")
      .update(JSON.stringify(solver.getOutput()))
      .digest("hex"),
  }
  console.log(JSON.stringify(result))
  if (process.env.EXPANSION_INSPECTION_OUTPUT) {
    writeFileSync(
      process.env.EXPANSION_INSPECTION_OUTPUT,
      JSON.stringify(result, null, 2),
    )
  }
} finally {
  prototype.endpointCollides = original
  indexPrototype.getCollisionCandidates = originalCandidates
}
