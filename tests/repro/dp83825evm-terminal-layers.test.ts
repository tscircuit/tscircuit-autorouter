import { expect, test } from "bun:test"
import { getTiEvmTerminalRoutingErrors } from "./get-ti-evm-terminal-routing-errors"

test("DP83825EVM routes to terminals on their physical copper layers", () => {
  const errors = getTiEvmTerminalRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/dp83825evm-terminal-layers.srj.json.gz",
      import.meta.url,
    ),
    pipeline: 7,
  })

  expect(errors).toEqual([])
}, 120_000)
