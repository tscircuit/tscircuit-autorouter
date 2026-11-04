import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  TraceContactGuard,
  TraceContactRepairSolver,
} from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

type ContactFixture = {
  jointParams: Omit<
    ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0],
    "connMap" | "mutatedPreloadedTraceIds"
  > & { mutatedPreloadedTraceIds: string[] }
  ownerParams: Omit<
    ConstructorParameters<typeof TraceContactRepairSolver>[0],
    "connMap" | "drcEvaluator" | "viaInPadDrcEvaluator"
  >
  netMap: Record<string, string[]>
}

test("Game Boy contact refinement retains DRC improvements without new shorts", (): void => {
  const fixture: ContactFixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/pipeline9-gameboy-contact-refinement.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = structuredClone(fixture.ownerParams)
  const connMap = new ConnectivityMap(fixture.netMap)
  const joint = new Pipeline9JointDrcRepairSolver({
    ...fixture.jointParams,
    mutatedPreloadedTraceIds: new Set(
      fixture.jointParams.mutatedPreloadedTraceIds,
    ),
    connMap,
  })
  const exactStage = joint.pipelineDef.find(
    (stage) => stage.solverName === "exactRepairSolver",
  )
  if (!exactStage) throw new Error("Missing exact DRC stage")
  exactStage.createSolver()
  const evaluate = joint.exactRepairSolver?.params.drcEvaluator
  if (!evaluate) throw new Error("Missing joint DRC evaluator")
  const owner = new TraceContactRepairSolver({
    ...fixture.ownerParams,
    connMap,
    drcEvaluator: evaluate,
    viaInPadDrcEvaluator: evaluate,
  })
  owner.solve()
  const output = owner.getOutput()
  expect(owner.solved).toBeTrue()
  expect(owner.failed).toBeFalse()
  expect(
    getDrcSnapshot(owner.params.srj, output, evaluate, connMap).count,
  ).toBeLessThanOrEqual(22)
  // This input previously rejected the whole repair and retained 126 errors.
  expect(
    Number(owner.stats.traceContactRepairCandidateChecks),
  ).toBeLessThanOrEqual(128)
  expect(
    new TraceContactGuard({
      srj: owner.params.srj,
      inputRoutes: owner.params.inputHdRoutes,
      connMap,
    }).getNewContactPairs(output),
  ).toEqual([])
  expect(
    output.reduce((count, route) => count + route.vias.length, 0),
  ).toBeLessThanOrEqual(
    owner.params.inputHdRoutes.reduce(
      (count, route) => count + route.vias.length,
      0,
    ),
  )
  for (let index = 0; index < output.length; index++) {
    expect(output[index]!.route[0]).toEqual(original.hdRoutes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(
      original.hdRoutes[index]!.route.at(-1),
    )
  }
  expect(fixture.ownerParams).toEqual(original)
})
