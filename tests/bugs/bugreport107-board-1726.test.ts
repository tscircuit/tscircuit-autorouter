import { writeFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport107-board-1726.json with Pipeline 9", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  try {
    solver.solve()
  } catch (error) {
    const activeRepair = solver.pipeline9JointDrcRepairSolver?.activeSubSolver
    if (activeRepair instanceof Pipeline9BoundedRegionalRepairSolver) {
      const { state } = activeRepair as unknown as { state: unknown }
      writeFileSync(
        new URL("./__snapshots__/bugreport107-regional-drc.received.json", import.meta.url),
        JSON.stringify(state, null, 2),
      )
    }
    throw error
  }

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { errors } = evaluateRelaxedDrc(drcInput)
  const stats = solver.pipeline9JointDrcRepairSolver!.stats
  // Repair stages and their conservative indexed counts can differ. Validate
  // the published copper with the reference checker, not a stage-local count.
  expect(stats.referenceDrcValidationCount).toBeGreaterThan(0)
  expect(errors).toHaveLength(0)
  const declaredDrc = evaluateRelaxedDrc({
    ...drcInput,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: srj.minTraceToPadEdgeClearance,
      viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  if (declaredDrc.errors.length > 0) {
    writeFileSync(
      new URL(
        "./__snapshots__/bugreport107-declared-drc.received.json",
        import.meta.url,
      ),
      JSON.stringify(
        {
          input: srj,
          pointPairs: solver.srjWithPointPairs,
          newConnections: solver.netToPointPairsSolver!.newConnections,
          jointRoutes: solver.pipeline9JointDrcRepairSolver!.getOutput(),
          beforePowerTraces: solver.getNewTracesBeforePowerExpansion(),
          finalTraces: drcInput.routedTraces,
          errors: declaredDrc.errors,
        },
        null,
        2,
      ),
    )
  }
  expect(
    declaredDrc.errors,
    JSON.stringify(declaredDrc.errors, null, 2),
  ).toHaveLength(0)
  expect(solver.pipelineDef.at(-1)?.solverName).toBe(
    "powerTraceExpansionSolver",
  )

  // Native routing can produce different valid route variants across platforms.
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    snapshotPath,
  )
})
