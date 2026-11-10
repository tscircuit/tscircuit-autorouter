import { expect, test } from "bun:test"
import { resolveDifferentialPairSegments } from "lib/utils/resolveDifferentialPairSegments"
import { createDifferentialPairSegmentInput } from "./fixtures/createDifferentialPairSegmentInput"
import { multiTerminalDifferentialPair } from "./fixtures/multiTerminalDifferentialPair"

test("component selectors disambiguate terminals closer to another component", (): void => {
  const srj = structuredClone(multiTerminalDifferentialPair)
  // Keep the same terminal tree, but make J1.DM closer to U1.DP than J1.DP.
  for (const point of srj.connections[1]!.pointsToConnect) point.x += 9
  const input = createDifferentialPairSegmentInput(srj)

  const pairs = resolveDifferentialPairSegments(input)

  expect(pairs).toHaveLength(2)
  for (const pair of pairs) {
    const owners = pair.connectionNames.map((name): string[] =>
      input.connections.find((connection): boolean => connection.name === name)!
        .pointsToConnect.map((point): string => point.port_selector!.split(".")[0]!).sort(),
    )
    expect(owners[0]).toEqual(owners[1])
  }
})
