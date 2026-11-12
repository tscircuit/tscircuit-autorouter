// As a PCB designer, I want only the ordered J1 -> ESD -> MCU hops
// sent to the USB length matcher, excluding the TP1 branch.
import { test } from "bun:test"
import { checkOrderedUsbPairLanes } from "./fixtures/check-ordered-usb-pair-lanes"
import { orderedUsbPipelines } from "./fixtures/ordered-usb-pair"

test("Pipeline 7 sends exactly the ordered USB hops to the matcher", (): void => {
  checkOrderedUsbPairLanes(orderedUsbPipelines[0])
})
