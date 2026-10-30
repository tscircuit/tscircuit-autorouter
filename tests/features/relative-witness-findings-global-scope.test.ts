import { expect, test } from "bun:test"
import { preservePipeline9RelativeFindings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preservePipeline9RelativeFindings"
import { relativeFindingPreservationFixture } from "./relativeFindingPreservationFixture"

test("local preservation cannot hide a new predicate finding or changed global scope", () => {
  const input = relativeFindingPreservationFixture()
  for (const mutate of [
    (value: typeof input) => { value.candidate.status = "PASS" },
    (value: typeof input) => { value.candidate.reasons.push("new demand failure") },
    (value: typeof input) => { value.candidate.demandsChecked-- },
    (value: typeof input) => { value.candidate.referenceErrorCount++ },
    (value: typeof input) => { value.after.boardReasons.push("Wire copper exceeds board envelope") },
    (value: typeof input) => { value.after.nativeErrors.push({ id: "new" }) },
    (value: typeof input) => { value.after.nativeErrorsWithCenters.push({ id: "new", center: { x: 0, y: 0 } }) },
    (value: typeof input) => { value.after.nativeLocationAwareErrors.push({ id: "new", center: { x: 0, y: 0 } }) },
    (value: typeof input) => { value.after.viaInPad.push({ id: "new" }) },
    (value: typeof input) => { value.after.viaPadPolicy.push({ id: "new" }) },
    (value: typeof input) => { value.candidate.copper.allFindings.push({ checkClass: "viaPad" }) },
    (value: typeof input) => { value.candidate.copper.allPublishedCopperChecksRun = false },
    (value: typeof input) => { value.candidate.copper.ownershipCoverageStatus = "UNKNOWN" },
    (value: typeof input) => { value.candidate.copper.checksRun.pop() },
    (value: typeof input) => { value.candidate.copper.checks.viaTrace.count = 1 },
    (value: typeof input) => { value.candidate.reasons = [undefined as unknown as string] },
  ]) {
    const changed = structuredClone(input); mutate(changed)
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
})
