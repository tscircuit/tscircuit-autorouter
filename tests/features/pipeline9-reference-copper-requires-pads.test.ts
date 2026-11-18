import { expect, test } from "bun:test"
import { canValidatePipeline9ReferenceCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canValidatePipeline9ReferenceCopper"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("reference DRC requires modeled ports and pads for fresh route terminals", (): void => {
  const { originalSrj } = createBoundedRegionalRepairFixture()
  const context = {
    originalSrj,
    connections: originalSrj.connections,
    hasNativePreloadedTraces: false,
  }
  const referenceCircuitJson = convertToCircuitJson(originalSrj, [])
  expect(
    canValidatePipeline9ReferenceCopper({ ...context, referenceCircuitJson }),
  ).toBeTrue()
  expect(
    canValidatePipeline9ReferenceCopper({
      ...context,
      referenceCircuitJson: referenceCircuitJson.filter(
        (element) =>
          element.type !== "pcb_smtpad" || element.pcb_port_id !== "end",
      ),
    }),
  ).toBeFalse()
  expect(
    canValidatePipeline9ReferenceCopper({
      ...context,
      referenceCircuitJson: referenceCircuitJson.filter(
        (element) =>
          element.type !== "pcb_port" || element.pcb_port_id !== "end",
      ),
    }),
  ).toBeFalse()
})
