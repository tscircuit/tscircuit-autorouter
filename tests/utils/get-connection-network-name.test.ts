import { expect, test } from "bun:test"
import { getConnectionNetworkName } from "lib/utils/getConnectionNetworkName"

test("connection network names are derived from sorted root aliases", () => {
  expect(
    getConnectionNetworkName({
      name: "branch_mst0",
      __rootConnectionNames: ["connection_b", "connection_a"],
      pointsToConnect: [],
    }),
  ).toBe("connection_a__connection_b")

  expect(
    getConnectionNetworkName({ name: "connection_a", pointsToConnect: [] }),
  ).toBe("connection_a")
})
