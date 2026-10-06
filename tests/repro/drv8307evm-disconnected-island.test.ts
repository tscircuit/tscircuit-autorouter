import { expect, test } from "bun:test"
import { getPipeline9TiEvmRoutingErrors } from "./getPipeline9TiEvmRoutingErrors"

test("DRV8307EVM Pipeline 9 leaves a disconnected route island", () => {
  const errors = getPipeline9TiEvmRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/drv8307evm-disconnected-island.srj.json.gz",
      import.meta.url,
    ),
  })

  expect(errors).toMatchInlineSnapshot(`
    {
      "danglingTraceMessages": [
        "Trace [trace[source_net_23_mst0_0]] has dangling endpoint at (66.09, 87.76)",
      ],
      "nonContiguousTraceMessages": [],
    }
  `)
})
