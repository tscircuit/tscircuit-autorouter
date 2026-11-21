import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"

type RegionalParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]

test("ButterStick regional repair omits search diagnostics by default", (): void => {
  const { params } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-regional-memory.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { params: RegionalParams }
  const connMap = new ConnectivityMap(params.connMap.netMap)
  connMap.idToNetMap = params.connMap.idToNetMap
  const solver = new Pipeline9RegionalFallbackSolver({ ...params, connMap })
  solver.solve()
  // This unsuccessful candidate precedes the repair that completes ButterStick.
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("All solvers failed")

  const attempts = solver.highDensitySolver.failedSolvers
    .filter(
      (attempt) => attempt instanceof GrowShrinkHighDensityIntraNodeSolver,
    )
    .flatMap((attempt) => attempt.failedSolvers)
  const candidates = attempts.flatMap(
    (attempt) => attempt.supervisedSolvers ?? [],
  )
  const failedSearches = candidates
    .map((candidate) => candidate.solver)
    .filter((candidate) => candidate instanceof IntraNodeRouteSolver)
    .flatMap((candidate) => candidate.failedSubSolvers)
  const retainedNodes = failedSearches.reduce(
    (count, search) => count + search.debug_exploredNodesOrdered.length,
    0,
  )
  expect(retainedNodes).toBe(0)
})
