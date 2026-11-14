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

test("contact repair continues regional repair without increasing board DRC", async (): Promise<void> => {
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
  while (!solver.solved && !solver.failed && !solver.regionalB01RepairSolver) {
    solver.step()
  }
  expect(solver.regionalB01RepairSolver).toBeDefined()
  const candidates = [
    {
      hdRoutes: structuredClone(solver.getOutput()),
      mutatedPreloadedTraces: structuredClone(
        solver.getMutatedPreloadedTraces(),
      ),
    },
  ]
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  candidates.push({
    hdRoutes: solver.getOutput(),
    mutatedPreloadedTraces: solver.getMutatedPreloadedTraces(),
  })
  const input = solver.params
  const evaluations = candidates.map((candidate) => ({
    inputSrj: input.originalSrj,
    srjWithPointPairs: input.srjWithPointPairs,
    routedTraces: [
      ...candidate.mutatedPreloadedTraces,
      ...convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: input.newConnections,
        originalConnections: input.originalSrj.connections,
        hdRoutes: canonicalizePipeline9HdRoutes(candidate.hdRoutes),
        layerCount: input.layerCount,
        obstacles: input.obstacles,
        defaultViaHoleDiameter: input.defaultViaHoleDiameter,
        connMap: input.connMap,
      }),
    ],
  }))
  const [contactRepairErrors, regionalRepairErrors] = evaluations.map(
    (evaluation) => evaluateRelaxedDrc(evaluation).errors,
  )
  expect(regionalRepairErrors!.length).toBeLessThan(
    contactRepairErrors!.length,
  )
  await expect(getBugReportSnapshotSvg(evaluations[1]!)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
