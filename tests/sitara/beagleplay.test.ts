import { test } from "bun:test"
import { expectSitaraRoutingPreparation } from "../fixtures/expectSitaraRoutingPreparation"

test("BeaglePlay: full-board routing preparation", async (): Promise<void> => {
  await expectSitaraRoutingPreparation({ sampleNumber: 3, boardName: "BeaglePlay", testPath: import.meta.path })
})
