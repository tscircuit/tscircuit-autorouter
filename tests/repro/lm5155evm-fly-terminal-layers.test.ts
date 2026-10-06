import { expect, test } from "bun:test"
import { getTiEvmTerminalRoutingErrors } from "./get-ti-evm-terminal-routing-errors"

test("LM5155EVM-FLY keeps routed endpoints on their terminal layers", () => {
  const errors = getTiEvmTerminalRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/lm5155evm-fly-terminal-layers.srj.json.gz",
      import.meta.url,
    ),
    pipeline: 7,
  })

  expect(errors).toEqual([])
}, 120_000)
