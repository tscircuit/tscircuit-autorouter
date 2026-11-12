// As a PCB designer, I want the real USB copper to show whether ordered
// D+/D- length matching completes while keeping TP1 outside the lane.
import { test } from "bun:test"
import { checkOrderedUsbPairSnapshot } from "./fixtures/check-ordered-usb-pair-snapshot"
import { orderedUsbPipelines } from "./fixtures/ordered-usb-pair"

test("Pipeline 7 renders actual USB copper at the matching boundary", async (): Promise<void> => {
  await checkOrderedUsbPairSnapshot(orderedUsbPipelines[0], import.meta.path)
})
