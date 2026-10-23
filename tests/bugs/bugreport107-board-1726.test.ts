import { writeFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import bugReport from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport107-board-1726.json with Pipeline 9", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  solver.solve()

  if (solver.failed) {
    const finalStage = solver.powerTraceExpansionSolver
    const srjWithPointPairs = solver.srjWithPointPairs
    const joint = solver.pipeline9JointDrcRepairSolver
    if (!finalStage?.solved || !srjWithPointPairs || !joint?.solved) {
      throw new Error(`Board 1726 failed before final copper: ${solver.error}`)
    }
    const finalStageInput =
      finalStage.inputSrj as Pipeline7PowerTraceExpansionInput
    const finalTraces = [
      ...finalStageInput.fixedTraces.filter(
        (trace) => trace.__replaces_pcb_trace_id !== undefined,
      ),
      ...finalStage.getOutput(),
    ]
    const { errors } = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces: finalTraces,
      includeBoardClearance: true,
      drcOptions: {
        includeTraceContinuity: false,
        traceClearance: srj.minTraceToPadEdgeClearance,
        viaClearance: srj.minPadEdgeToPadEdgeClearance,
      },
    })
    const repairCandidates: {
      initialPublished?: HighDensityRoute[]
      initialPrivate?: HighDensityRoute[]
      exact?: HighDensityRoute[]
      regionalB01?: HighDensityRoute[]
      finalPublished?: HighDensityRoute[]
      finalPrivate?: HighDensityRoute[]
    } = {}
    const initial = joint.initialBoundedRegionalRepairSolver
    if (initial?.solved && !initial.failed) {
      repairCandidates.initialPublished = initial.getResult().routes
      repairCandidates.initialPrivate = initial.getRoutesForFurtherRepair()
    }
    if (joint.exactRepairSolver?.solved && !joint.exactRepairSolver.failed) {
      repairCandidates.exact = joint.exactRepairSolver.getOutput()
    }
    const regionalB01 = joint.regionalB01RepairSolver
    if (regionalB01?.solved && !regionalB01.failed) {
      repairCandidates.regionalB01 = regionalB01.getResult().routes
    }
    const bounded = joint.boundedRegionalRepairSolver
    if (bounded?.solved && !bounded.failed) {
      repairCandidates.finalPublished = bounded.getResult().routes
      repairCandidates.finalPrivate = bounded.getRoutesForFurtherRepair()
    }
    writeFileSync(
      new URL(
        "./__snapshots__/bugreport107-declared-drc.received.json",
        import.meta.url,
      ),
      JSON.stringify(
        {
          input: srj,
          pointPairs: srjWithPointPairs,
          newConnections: solver.netToPointPairsSolver!.newConnections,
          jointInput: {
            ...joint.params,
            connMap: undefined,
            mutatedPreloadedTraceIds: [...joint.params.mutatedPreloadedTraceIds],
          },
          jointRoutes: joint.getOutput(),
          beforePowerTraces: solver.getNewTracesBeforePowerExpansion(),
          finalTraces,
          errors,
          stats: solver.stats,
          jointStats: joint.stats,
          phaseTimesMs: solver.timeSpentOnPhase,
          repairCandidates,
        },
        null,
        2,
      ),
    )
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
  // Initial bounded repair can solve native route variants before exact repair.
  if (stats.initialBoundedRegionalRepairAccepted === true) {
    expect(stats.initialBoundedRegionalRepairPublishedDrcIssueCount).toBe(0)
    expect(stats.boundedRegionalRepairPublishedDrcIssueCount).toBe(0)
  } else {
    expect(stats.boundedRegionalRepairPublishedDrcIssueCount).toBeLessThan(
      stats.postExactReferenceDrcIssueCount,
    )
  }
  expect(errors.length).toBeLessThanOrEqual(
    stats.boundedRegionalRepairPublishedDrcIssueCount,
  )
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
