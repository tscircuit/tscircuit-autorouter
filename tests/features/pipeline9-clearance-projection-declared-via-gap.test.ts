import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getNewViaPadViolations } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

type JointRepairInput = ConstructorParameters<
  typeof Pipeline9JointDrcRepairSolver
>[0]
type Ecp5RepairFixture = {
  input: Omit<JointRepairInput, "srj" | "connMap" | "mutatedPreloadedTraceIds">
  netMap: ConnectivityMap["netMap"]
}

test("keeps a clearance repair whose moved vias meet the declared board gap", (): void => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/ecp5-ddr-declared-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Ecp5RepairFixture
  const joint = new Pipeline9JointDrcRepairSolver({
    ...fixture.input,
    srj: fixture.input.srjWithPointPairs,
    connMap: new ConnectivityMap(fixture.netMap),
    mutatedPreloadedTraceIds: new Set(),
  })
  joint.step()
  const projection = joint.clearanceProjectionSolver
  if (!projection) throw new Error("Missing native DDR clearance projection")
  const original = structuredClone(projection.params.routes)
  projection.solve()
  expect(projection.solved).toBeTrue()
  expect(projection.failed).toBeFalse()
  const routes = projection.getOutput()
  expect(routes).not.toBe(projection.params.routes)
  expect(projection.params.routes).toEqual(original)
  const srj = { ...projection.params.originalSrj, traces: undefined }
  const viaClearance = srj.minViaEdgeToPadEdgeClearance
  expect(viaClearance).toBeDefined()
  const guardInput = { srj, routes, previousRoutes: original }
  // The implicit 0.1 mm guard rejects legal gaps on this 0.089 mm board.
  expect(getNewViaPadViolations(guardInput).length).toBeGreaterThan(0)
  expect(getNewViaPadViolations({ ...guardInput, viaClearance })).toEqual([])
  const validation = projection.params.drcEvaluator({
    traces: [],
    routes,
    hdRoutes: routes,
  })
  const initial = projection.params.drcEvaluator({
    traces: [],
    routes: original,
    hdRoutes: original,
  })
  const errors = Array.isArray(validation) ? validation : validation.errors
  const initialErrors = Array.isArray(initial) ? initial : initial.errors
  expect(errors.length).toBeLessThan(initialErrors.length)
})
