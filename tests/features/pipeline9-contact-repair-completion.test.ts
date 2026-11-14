import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"

type JointRepairInput = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]
type ContactFixture = {
  jointParams: Omit<
    JointRepairInput,
    "connMap" | "mutatedPreloadedTraceIds"
  > & {
    mutatedPreloadedTraceIds: string[]
  }
  netMap: ConnectivityMap["netMap"]
}

test("contact repair skips regional clearance repair", async (): Promise<void> => {
  const fixture: ContactFixture = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/pipeline9-gameboy-contact-refinement.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new Pipeline9JointDrcRepairSolver({
    ...fixture.jointParams,
    connMap: new ConnectivityMap(fixture.netMap),
    mutatedPreloadedTraceIds: new Set(
      fixture.jointParams.mutatedPreloadedTraceIds,
    ),
  })
  solver.solve()
  const input = solver.params
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: input.newConnections,
    originalConnections: input.originalSrj.connections,
    hdRoutes: canonicalizePipeline9HdRoutes(solver.getOutput()),
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    defaultViaHoleDiameter: input.defaultViaHoleDiameter,
    connMap: input.connMap,
  })
  const evaluation = {
    inputSrj: input.originalSrj,
    srjWithPointPairs: input.srjWithPointPairs,
    routedTraces: [...solver.getMutatedPreloadedTraces(), ...traces],
  }
  const { errors } = evaluateRelaxedDrc(evaluation)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.regionalB01RepairSolver).toBeUndefined()
  expect(errors.length).toBeGreaterThan(0)
  await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
