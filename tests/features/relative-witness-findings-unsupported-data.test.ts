import { expect, test } from "bun:test"
import { preservePipeline9RelativeFindings } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preservePipeline9RelativeFindings"
import { relativeFindingPreservationFixture } from "./relativeFindingPreservationFixture"

test("undefined and nonfinite data cannot disappear through finding serialization", () => {
  const input = relativeFindingPreservationFixture()
  for (const value of [undefined, NaN, Infinity, -Infinity, new Date(0), 1n]) {
    const changed = structuredClone(input)
    changed.before.srjObstacles[0]!.unrecognized = value
    changed.after.srjObstacles[0]!.unrecognized = value
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
  const sparse = new Array(1)
  const extra = [1] as number[] & { hidden?: number }; extra.hidden = 2
  const symbol = { [Symbol("hidden")]: 2 }
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  for (const value of [sparse, extra, symbol, cyclic, Object.setPrototypeOf([1], null)]) {
    const changed = structuredClone(input)
    changed.before.srjObstacles[0]!.unrecognized = value
    changed.after.srjObstacles[0]!.unrecognized = value
    expect(preservePipeline9RelativeFindings(changed).status).toBe("UNKNOWN")
  }
  const outer = structuredClone(input)
  outer.before.nativeErrors = new Array(1); outer.after.nativeErrors = new Array(1)
  outer.baseline.referenceErrorCount = outer.candidate.referenceErrorCount = 1
  expect(preservePipeline9RelativeFindings(outer).status).toBe("UNKNOWN")
  const board = structuredClone(input)
  Object.assign(board.before.boardReasons, { hidden: true }); Object.assign(board.after.boardReasons, { hidden: true })
  expect(preservePipeline9RelativeFindings(board).status).toBe("UNKNOWN")
  const zeros = structuredClone(input)
  zeros.before.srjObstacles[0]!.extraMetric = -0
  zeros.after.srjObstacles[0]!.extraMetric = 0
  expect(preservePipeline9RelativeFindings(zeros).status).toBe("UNKNOWN")
})
