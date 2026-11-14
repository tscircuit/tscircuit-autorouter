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

test("regional repair accepts moved vias that meet the explicit board gap", (): void => {
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
  while (
    !joint.initialBoundedRegionalRepairSolver &&
    !joint.failed &&
    !joint.solved
  ) {
    joint.step()
  }
  const regional = joint.initialBoundedRegionalRepairSolver
  if (!regional) throw new Error("Missing native DDR regional repair")
  regional.solve()
  expect(regional.solved).toBeTrue()
  expect(regional.failed).toBeFalse()
  const result = regional.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.publishedDrcIssueCount).toBe(0)
  const srj = { ...regional.params.originalSrj, traces: undefined }
  const guardInput = {
    srj,
    routes: result.routes,
    previousRoutes: regional.params.routes,
  }
  // The implicit 0.1 mm guard rejects this legal 0.089 mm board repair.
  expect(getNewViaPadViolations(guardInput).length).toBeGreaterThan(0)
  expect(
    getNewViaPadViolations({
      ...guardInput,
      viaClearance: srj.minViaEdgeToPadEdgeClearance,
    }),
  ).toEqual([])
})
