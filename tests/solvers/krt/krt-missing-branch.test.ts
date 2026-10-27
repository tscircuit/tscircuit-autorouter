import { expect, test } from "bun:test"
import { acceptKrtBranches } from "lib/testing/acceptKrtBranches"
import { prepareKrtBranches } from "lib/testing/prepareKrtBranches"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT cannot claim completion after omitting a terminal branch", (): void => {
  const original = krtTestBoard()
  const { branches } = prepareKrtBranches(original)
  expect(branches).toHaveLength(2)
  expect(() => acceptKrtBranches({ original, branches, proposed: [], gridStep: 0.1 })).toThrow("omitted 2")
})
