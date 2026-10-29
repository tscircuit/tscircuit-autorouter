import { createHash } from "node:crypto"
import Flatbush from "flatbush"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadMotherboardPowerPhase } from "./repro"

const originalCheck =
  SingleHighDensityRouteSolver.prototype.isNodeTooCloseToObstacle
const originalSearch = Flatbush.prototype.search
const counts = { viaChecks: 0, edgeInvalidViaChecks: 0, viaSpatialSearches: 0 }
let viaDepth = 0
SingleHighDensityRouteSolver.prototype.isNodeTooCloseToObstacle = function (
  ...args: Parameters<typeof originalCheck>
): ReturnType<typeof originalCheck> {
  const isVia = Boolean(args[2])
  if (isVia) {
    counts.viaChecks++
    if (this.isNodeTooCloseToEdge(args[0], true)) counts.edgeInvalidViaChecks++
    viaDepth++
  }
  try {
    return originalCheck.apply(this, args)
  } finally {
    if (isVia) viaDepth--
  }
}
Flatbush.prototype.search = function (
  ...args: Parameters<typeof originalSearch>
): ReturnType<typeof originalSearch> {
  if (viaDepth > 0) counts.viaSpatialSearches++
  return originalSearch.apply(this, args)
}
try {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    loadMotherboardPowerPhase(),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()
  if (!solver.solved || solver.failed) {
    throw new Error(solver.error ?? "Route failed")
  }
  console.log(
    JSON.stringify({
      ...counts,
      iterations: solver.iterations,
      outputHash: createHash("sha256")
        .update(JSON.stringify(solver.getOutputSimpleRouteJson()))
        .digest("hex"),
    }),
  )
} finally {
  SingleHighDensityRouteSolver.prototype.isNodeTooCloseToObstacle =
    originalCheck
  Flatbush.prototype.search = originalSearch
}
