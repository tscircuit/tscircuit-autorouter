import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  getH616JointRepairCircuit,
  type H616JointRepairFixture,
} from "tests/fixtures/getH616JointRepairCircuit"
import { getH616JointRepairPcbSvg } from "tests/fixtures/getH616JointRepairPcbSvg"

test("H616 continues clearance repair after repairing trace contacts", async (): Promise<void> => {
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
  while (!solver.solved && !solver.failed && !solver.regionalB01RepairSolver) {
    solver.step()
  }
  expect(solver.regionalB01RepairSolver).toBeDefined()
  const contactRepairCircuit = getH616JointRepairCircuit({ fixture, solver })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.regionalB01RepairAcceptedCount).toBeGreaterThan(0)
  const circuitJson = getH616JointRepairCircuit({ fixture, solver })
  // Use the native board's declared copper clearances in both evaluations.
  const circuits = [contactRepairCircuit, circuitJson]
  const [contactRepairErrors, drcErrors] = circuits.map(
    (circuit) =>
      getDrcErrors(circuit, {
        traceClearance:
          fixture.jointRepairInput.originalSrj.minTraceToPadEdgeClearance,
        viaToPadClearance:
          fixture.jointRepairInput.originalSrj.minViaEdgeToPadEdgeClearance,
        includeTraceContinuity: false,
      }).errors,
  )
  expect(drcErrors!.length).toBeLessThan(contactRepairErrors!.length)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toEqual(
    fixture.circuitJson.filter((element) => element.type === "pcb_component"),
  )
  const outputConnectionNames = solver
    .getOutput()
    .map((route) => route.connectionName)
  expect(outputConnectionNames.sort()).toEqual(
    fixture.jointRepairInput.newHdRoutes
      .map((route) => route.connectionName)
      .sort(),
  )
  const svg = getH616JointRepairPcbSvg({
    circuitJson,
    drcErrorCount: drcErrors!.length,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })

  const focused = getH616JointRepairPcbSvg({
    circuitJson,
    drcErrorCount: drcErrors!.length,
    focused: true,
  })
  await expect(focused).toMatchSvgSnapshot(import.meta.path, {
    svgName: "ram",
    scale: 1,
  })
})
