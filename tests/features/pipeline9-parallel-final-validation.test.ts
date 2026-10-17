import { expect, spyOn, test } from "bun:test"
import * as checks from "@tscircuit/checks"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("search-only DRC can defer continuity and board checks while full validation retains them", (): void => {
  const board = spyOn(checks, "checkPcbTracesOutOfBoard")
  const continuity = spyOn(checks, "checkTracesAreContiguous")
  try {
    getDrcErrors([], { includeBoardClearance: false, includeTraceContinuity: false })
    expect(board).not.toHaveBeenCalled()
    expect(continuity).not.toHaveBeenCalled()
    getDrcErrors([])
    expect(board).toHaveBeenCalledTimes(1)
    expect(continuity).toHaveBeenCalledTimes(1)
  } finally {
    board.mockRestore()
    continuity.mockRestore()
  }
})
