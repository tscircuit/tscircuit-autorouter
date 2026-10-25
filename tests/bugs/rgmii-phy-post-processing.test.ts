import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { PostProcessingSolver } from "@tscircuit/length-matching-solver"
import type { AnyCircuitElement } from "circuit-json"
import { LengthMatchingPostProcessingSolver } from "../../lib/solvers/length-matching-post-processing-solver"
import type { SimpleRouteJson } from "../../lib/types"
import { getRealBoardPostProcessingSnapshotSvg } from "../fixtures/getRealBoardPostProcessingSnapshotSvg"

const readFixture = async (filename: string): Promise<string> => {
  const fixtureUrl = new URL(
    `../../fixtures/bug-reports/rgmii-phy-post-processing/${filename}`,
    import.meta.url,
  )
  return gunzipSync(await Bun.file(fixtureUrl).bytes()).toString("utf8")
}

test("RGMII PHY board reports all rejected MDI post-processing diagnostics", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = JSON.parse(await readFixture("board.srj.json.gz"))
  const srjWithPointPairs: SimpleRouteJson = JSON.parse(await readFixture("point-pairs.srj.json.gz"))
  const boardCircuitJson: AnyCircuitElement[] = JSON.parse(await readFixture("placement.circuit.json.gz"))
  const stageInput: ConstructorParameters<typeof LengthMatchingPostProcessingSolver>[0] =
    JSON.parse(await readFixture("stage-input.json.gz"))

  expect(inputSrj.connections).toHaveLength(45)
  expect(inputSrj.differentialPairs).toHaveLength(4)
  expect(inputSrj.buses).toHaveLength(2)
  expect(stageInput.hdRoutes).toHaveLength(199)
  // Replay all real MDI constraints; exclude subsequent RGMII bus tuning.
  const mdiInput = { ...stageInput, buses: [] }
  const producer = new PostProcessingSolver({
    ...mdiInput,
    minTraceToPadEdgeClearance: stageInput.obstacleMargin,
  })
  producer.solve()
  expect(producer.failed).toBe(false)
  const candidate = producer.getOutput()
  expect(candidate.postProcessingErrors.map((error) => error.reason)).toEqual([
    "terminal-layer-mismatch",
    "no-valid-candidate",
    "no-valid-candidate",
    "terminal-layer-mismatch",
    "meander-search-exhausted",
  ])

  const solver = new LengthMatchingPostProcessingSolver(mdiInput)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe(
    candidate.postProcessingErrors.map((error) => error.message).join("\n"),
  )
  expect(() => solver.getOutput()).toThrow("output requested before completion")

  await expect(getRealBoardPostProcessingSnapshotSvg({
    inputSrj,
    boardCircuitJson,
    srjWithPointPairs,
    candidateHdRoutes: candidate.hdRoutes,
    diagnostics: candidate.postProcessingErrors,
    solver: {
      name: solver.getSolverName(),
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
    },
  })).toMatchSvgSnapshot(import.meta.path)
})
