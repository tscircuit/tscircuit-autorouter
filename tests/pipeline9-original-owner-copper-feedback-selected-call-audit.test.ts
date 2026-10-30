import { expect, test } from "bun:test"
import { checkViaPadClearance, checkPadTraceClearance, checkViaTraceClearance, checkEachPcbTraceNonOverlapping,
  checkDifferentNetViaSpacing, checkSameNetViaSpacing, checkPadPadClearance } from "@tscircuit/checks"
import { checkPipeline9OriginalIntentCopper, checkPipeline9SelectedOriginalIntentCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9OriginalIntentCopper"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("selected references invoke exactly two actual predicates and retain the complete seven-check inventory without claiming a full grade", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  const input = { original: fixture.params.originalSrj, pointPairs: fixture.params.srjWithPointPairs,
    traces: evaluated.traces, circuitJson: evaluated.native.circuitJson }
  const before = JSON.stringify(input)
  const calls: string[] = []
  const native = { viaPad: checkViaPadClearance, padTrace: checkPadTraceClearance, viaTrace: checkViaTraceClearance,
    traceOverlap: checkEachPcbTraceNonOverlapping, differentNetViaSpacing: checkDifferentNetViaSpacing,
    sameNetViaSpacing: checkSameNetViaSpacing, padPad: checkPadPadClearance }
  const suite = Object.fromEntries(Object.entries(native).map(([name, checker]) => [name,
    (circuit: Parameters<typeof checker>[0], options: Parameters<typeof checker>[1]): ReturnType<typeof checker> => {
      calls.push(name)
      return checker(circuit, options)
    }]))
  const full = checkPipeline9OriginalIntentCopper(input, suite)
  expect(calls).toEqual(Object.keys(native))
  calls.length = 0
  const selected = checkPipeline9SelectedOriginalIntentCopper(input, {
    viaTrace: suite.viaTrace!, traceOverlap: suite.traceOverlap!,
  })
  expect(calls).toEqual(["viaTrace", "traceOverlap"])
  expect(selected.checksRun).toEqual(["viaTrace", "traceOverlap"])
  expect(Object.keys(selected.checks)).toEqual(["viaTrace", "traceOverlap"])
  expect(selected.allFindings).toEqual(full.allFindings.filter((finding: Record<string, unknown>) =>
    finding.checkClass === "viaTrace" || finding.checkClass === "traceOverlap"))
  for (const key of ["ownershipCoverageStatus", "unknownViaCount", "unknownPadCount", "unknownTraceCount", "unknownOwnerReasonCounts",
    "viaCount", "padCount", "traceCount", "viaOwners", "padOwners", "traceOwners", "originalObstacleCoverage",
    "canonicalSemanticKey", "copperGeometryKey", "originalStackSupported", "supportedStackLayers", "geometryUnchanged"] as const) {
    expect(selected[key]).toEqual(full[key])
  }
  expect(selected.reportKind).toBe("SELECTED_ORIGINAL_OWNER_COPPER")
  expect(selected.fullCopperGrade).toBe("NOT_EVALUATED")
  expect(selected.allPublishedCopperChecksRun).toBe(false)
  expect("status" in selected).toBe(false)
  expect("qualifiedSupportedCopper" in selected).toBe(false)
  expect("qualifiedPhysicalClean" in selected).toBe(false)
  expect(JSON.stringify(input)).toBe(before)
})
