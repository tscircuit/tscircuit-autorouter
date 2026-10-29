import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateJointOriginalViaPlacement, makeJointOriginalViaPlacementFixture } from "./fixtures/pipeline9JointOriginalViaPlacement"

test("the actual via-pad checker retains declared same-owner pad permission", (): void => {
  const own = makeJointOriginalViaPlacementFixture("own-pad")
  const foreign = makeJointOriginalViaPlacementFixture("foreign-pad")
  const checkedOwn = evaluateJointOriginalViaPlacement(own, own.params.newHdRoutes)
  const checkedForeign = evaluateJointOriginalViaPlacement(foreign, foreign.params.newHdRoutes)
  const via = checkedOwn.reference.circuitJson.find((element) => element.type === "pcb_via")!
  const typedMap = getFullConnectivityMapFromCircuitJson(checkedOwn.reference.circuitJson)
  expect(via.type).toBe("pcb_via")
  if (via.type !== "pcb_via") throw new Error("Expected the actual manufactured via")
  expect(typedMap.areIdsConnected(via.pcb_via_id, "original_pad_with_under_scores")).toBe(true)
  expect(checkedOwn.pad).toEqual([])
  expect(checkedForeign.pad).toHaveLength(1)
  const enabled = new Pipeline9JointDrcRepairSolver({ ...own.params, checkOriginalViaPlacement: true })
  const disabled = new Pipeline9JointDrcRepairSolver({
    ...makeJointOriginalViaPlacementFixture("own-pad").params, checkOriginalViaPlacement: false,
  })
  expect(enabled.stats.initialJointDrcIssueCount).toBe(disabled.stats.initialJointDrcIssueCount)
  expect(enabled.stats.initialJointDrcIssueCountByType).toEqual(disabled.stats.initialJointDrcIssueCountByType)
})
