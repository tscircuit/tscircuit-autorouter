import { expect, test } from "bun:test"
import { getPipeline9TiEvmRoutingErrors } from "./getPipeline9TiEvmRoutingErrors"

test("LM5155EVM-FLY Pipeline 9 keeps routed terminal layers connected", () => {
  const errors = getPipeline9TiEvmRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/lm5155evm-fly-terminal-layers.srj.json.gz",
      import.meta.url,
    ),
  })

  expect(errors).toEqual({
    danglingTraceMessages: [],
    nonContiguousTraceMessages: [],
  })
})
