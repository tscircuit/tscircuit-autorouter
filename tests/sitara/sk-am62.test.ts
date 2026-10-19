import { test } from "bun:test"
import { expectSitaraRoutingPreparation } from "../fixtures/expectSitaraRoutingPreparation"

test("SK-AM62: full-board routing preparation", async (): Promise<void> => {
  await expectSitaraRoutingPreparation({ sampleNumber: 2, boardName: "SK-AM62", testPath: import.meta.path })
})
