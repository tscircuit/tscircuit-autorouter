// As a PCB designer, I want the PCB snapshot to show which pads the
// default pipeline actually connects for the written C -> A -> B path.
import { test } from "bun:test"
import { checkOrderedTracePathSnapshot } from "./fixtures/check-ordered-trace-path-snapshot"

test("renders the actual default-pipeline trace path order", async (): Promise<void> => {
  await checkOrderedTracePathSnapshot(import.meta.path)
})
