import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

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

test("contact repair reports completion with unresolved joint DRC", (): void => {
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
    hdRoutes: solver.getOutput(),
    layerCount: input.layerCount,
    obstacles: input.obstacles,
    defaultViaHoleDiameter: input.defaultViaHoleDiameter,
    connMap: input.connMap,
  })
  const evaluateDrc = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: {
      ...input.originalSrj,
      traces: solver.getUpdatedPreloadedTraces(),
    },
    srjWithPointPairs: input.srjWithPointPairs,
    includeBoardClearance: true,
  })
  const { errors } = evaluateDrc(traces)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(errors.length).toBeGreaterThan(0)
})
