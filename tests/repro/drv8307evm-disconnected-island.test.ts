import { expect, test } from "bun:test"
import { getTiEvmTerminalRoutingErrors } from "./get-ti-evm-terminal-routing-errors"

test("DRV8307EVM does not emit a disconnected route island", () => {
  const errors = getTiEvmTerminalRoutingErrors({
    fixtureUrl: new URL(
      "../../fixtures/repro/drv8307evm-disconnected-island.srj.json.gz",
      import.meta.url,
    ),
    pipeline: 9,
  })

  expect(errors).toEqual([])
}, 120_000)
