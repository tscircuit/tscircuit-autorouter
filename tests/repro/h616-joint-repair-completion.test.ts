import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  getH616AcceptedJointRepairCircuit,
  type H616JointRepairFixture,
} from "tests/fixtures/getH616AcceptedJointRepairCircuit"
import { getH616JointRepairPcbSvg } from "tests/fixtures/getH616JointRepairPcbSvg"

test("H616 joint repair reports completion with clearance errors", async (): Promise<void> => {
  const fixture: H616JointRepairFixture = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-joint-drc-completion.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new Pipeline9JointDrcRepairSolver({
    ...fixture.jointRepairInput,
    connMap: new ConnectivityMap(fixture.netMap),
    mutatedPreloadedTraceIds: new Set(
      fixture.jointRepairInput.mutatedPreloadedTraceIds,
    ),
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.postExactReferenceAccepted).toBeFalse()
  expect(solver.stats.postExactReferenceDrcIssueCount).toBeGreaterThan(0)
  const circuitJson = getH616AcceptedJointRepairCircuit({ fixture, solver })
  const drcErrors = getDrcErrors(circuitJson, {
    traceClearance:
      fixture.jointRepairInput.originalSrj.minTraceToPadEdgeClearance,
    viaToPadClearance:
      fixture.jointRepairInput.originalSrj.minViaEdgeToPadEdgeClearance,
    includeTraceContinuity: false,
  }).errors
  expect(drcErrors.length).toBeGreaterThan(0)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toEqual(
    fixture.circuitJson.filter((element) => element.type === "pcb_component"),
  )
  const svg = getH616JointRepairPcbSvg({
    circuitJson,
    phaseAccepted: solver.solved,
    drcErrorCount: drcErrors.length,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })

  const focused = getH616JointRepairPcbSvg({
    circuitJson,
    phaseAccepted: solver.solved,
    drcErrorCount: drcErrors.length,
    focused: true,
  })
  await expect(focused).toMatchSvgSnapshot(import.meta.path, {
    svgName: "ram",
    scale: 1,
  })
})
