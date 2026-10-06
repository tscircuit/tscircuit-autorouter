import { expect, test } from "bun:test"
import { getPipeline9TiEvmRoutingErrors } from "./getPipeline9TiEvmRoutingErrors"

test("LM5155EVM-FLY Pipeline 9 disconnects routed terminal layers", () => {
  const errors = getPipeline9TiEvmRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/lm5155evm-fly-terminal-layers.srj.json.gz",
      import.meta.url,
    ),
  })

  expect(errors).toMatchInlineSnapshot(`
    {
      "danglingTraceMessages": [
        "Trace [trace[source_net_18_mst5_0]] has dangling endpoint at (57.38, 42.14)",
        "Trace [trace[source_net_18_mst5_0]] has dangling endpoint at (38.39, 50.80)",
      ],
      "nonContiguousTraceMessages": [],
    }
  `)
})
