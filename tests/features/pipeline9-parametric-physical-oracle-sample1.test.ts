import { expect, test } from "bun:test"
import { checkPipeline9ParametricPhysicalOracle } from "../fixtures/checkPipeline9ParametricPhysicalOracle"

test("prepared SRJ18 sample 1 cell choices equal the original oracle and the complete board stays physically clean", async (): Promise<void> => {
  const result = await checkPipeline9ParametricPhysicalOracle(1)
  expect(result.checkedCells).toBeGreaterThan(0)
  expect(result.compiledCells).toBeGreaterThan(0)
  expect(result.cacheHits).toBeGreaterThan(0)
  expect(result.rejectedObstacles).toBeGreaterThan(0)
  expect(result.rejectedObstacles).toBeLessThanOrEqual(result.preparedObstacles)
})
