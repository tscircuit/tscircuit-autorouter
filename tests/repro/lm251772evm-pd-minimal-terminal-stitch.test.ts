import { expect, test } from "bun:test"
import { getPipeline9TiEvmRoutingErrors } from "./getPipeline9TiEvmRoutingErrors"

test("LM251772EVM-PD minimal variant stitches shared-root terminals", () => {
  const errors = getPipeline9TiEvmRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/lm251772evm-pd-minimal-terminal-stitch.srj.json.gz",
      import.meta.url,
    ),
  })

  expect(errors).toEqual({
    danglingTraceMessages: [],
    nonContiguousTraceMessages: [],
  })
}, 30_000)
