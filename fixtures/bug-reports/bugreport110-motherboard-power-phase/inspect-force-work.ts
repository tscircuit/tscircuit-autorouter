import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { loadMotherboardPowerPhase } from "./repro"

type ForceGeometry = {
  segments: { layer: number; p1Force?: object; p2Force?: object }[]
}
type WorkspaceInspector = {
  prepareForceWorkspace(lines: unknown[]): { geometry: ForceGeometry[] }
}
const prototype =
  MultiHeadPolyLineIntraNodeSolver2.prototype as unknown as WorkspaceInspector
const original = prototype.prepareForceWorkspace
const counts = {
  forceSteps: 0,
  endpointInteractions: 0,
  inertEndpointInteractions: 0,
}
prototype.prepareForceWorkspace = function (lines: unknown[]): {
  geometry: ForceGeometry[]
} {
  const workspace = original.call(this, lines)
  counts.forceSteps++
  for (let i = 0; i < workspace.geometry.length; i++) {
    for (let j = i + 1; j < workspace.geometry.length; j++) {
      for (const a of workspace.geometry[i]!.segments) {
        for (const b of workspace.geometry[j]!.segments) {
          if (a.layer !== b.layer) continue
          counts.endpointInteractions += 4
          if (!a.p1Force && !b.p1Force && !b.p2Force) {
            counts.inertEndpointInteractions++
          }
          if (!a.p2Force && !b.p1Force && !b.p2Force) {
            counts.inertEndpointInteractions++
          }
          if (!b.p1Force && !a.p1Force && !a.p2Force) {
            counts.inertEndpointInteractions++
          }
          if (!b.p2Force && !a.p1Force && !a.p2Force) {
            counts.inertEndpointInteractions++
          }
        }
      }
    }
  }
  return workspace
}
try {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    loadMotherboardPowerPhase(),
    { effort: 1, cacheProvider: null },
  )
  while (
    !solver.failed &&
    !solver.solved &&
    !solver.highDensityRouteSolver?.solved
  ) {
    solver.step()
  }
  if (solver.failed || !solver.highDensityRouteSolver?.solved) {
    throw new Error(String(solver.error))
  }
  const result = {
    ...counts,
    routeHash: createHash("sha256")
      .update(JSON.stringify(solver.highDensityRouteSolver.routes))
      .digest("hex"),
  }
  console.log(JSON.stringify(result))
  if (process.env.FORCE_INSPECTION_OUTPUT) {
    writeFileSync(
      process.env.FORCE_INSPECTION_OUTPUT,
      JSON.stringify(result, null, 2),
    )
  }
} finally {
  prototype.prepareForceWorkspace = original
}
