import { expect, test } from "bun:test"
import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createIntraNodeSegmentValidator } from "lib/solvers/HyperHighDensitySolver/createIntraNodeSegmentValidator"

type ValidationCapture = {
  params: Parameters<typeof createIntraNodeSegmentValidator>[0]
  proposals: Parameters<StaticSegmentValidator>[0][]
}

test("validates the captured ButterStick native-copper search", (): void => {
  const { params, proposals } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-native-segment-validation.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as ValidationCapture
  const connMap = new ConnectivityMap(params.connMap.netMap)
  connMap.idToNetMap = params.connMap.idToNetMap
  const validate = createIntraNodeSegmentValidator({ ...params, connMap })
  let decisions = ""
  let accepted = 0
  for (const proposal of proposals) {
    const isClear = validate(proposal)
    decisions += Number(isClear)
    if (isClear) accepted += 1
  }

  expect(proposals).toHaveLength(8192)
  expect(accepted).toBe(6186)
  expect(createHash("sha256").update(decisions).digest("hex")).toBe(
    "d48fc2ef503a0aa6cf70fb9642a15387c95ab5bec99bb4fdb135f369b5218b9f",
  )
})
