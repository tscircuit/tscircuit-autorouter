import { test } from "bun:test"
import { expectSitaraRoutingPreparation } from "../fixtures/expectSitaraRoutingPreparation"

test("BeagleBone Black: full-board routing preparation", async (): Promise<void> => {
  await expectSitaraRoutingPreparation({
    sampleNumber: 4,
    boardName: "BeagleBone Black",
    testPath: import.meta.path,
  })
})
