import { expect, test } from "bun:test"
import { getPipeline9TiEvmRoutingErrors } from "./getPipeline9TiEvmRoutingErrors"

test("DRV8307EVM Pipeline 9 omits disconnected route islands", () => {
  const errors = getPipeline9TiEvmRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/drv8307evm-disconnected-island.srj.json.gz",
      import.meta.url,
    ),
  })

  expect(errors).toEqual({
    danglingTraceMessages: [],
    nonContiguousTraceMessages: [],
  })
})
