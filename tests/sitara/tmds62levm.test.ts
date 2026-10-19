import { test } from "bun:test"
import { expectSitaraRoutingPreparation } from "../fixtures/expectSitaraRoutingPreparation"

test("TMDS62LEVM: full-board routing preparation", async (): Promise<void> => {
  await expectSitaraRoutingPreparation({
    sampleNumber: 1,
    boardName: "TMDS62LEVM",
    testPath: import.meta.path,
  })
})
