import { expect, test } from "bun:test"
import { compareSvgSnapshot } from "../fixtures/compareSvgSnapshot"

test("SVG snapshot tolerance counts changed pixels", async (): Promise<void> => {
  const start =
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/>'
  const reference = `${start}</svg>`
  const scatteredChanges =
    `${start}<rect x="10" y="10" width="4" height="4" fill="black"/>` +
    '<rect x="84" y="84" width="4" height="4" fill="black"/></svg>'
  const smallDifference = await compareSvgSnapshot(scatteredChanges, reference, {
    scale: 1,
    tolerance: 0.01,
  })
  expect(smallDifference.matches).toBe(true)
  expect(smallDifference.diffPercentage).toBeGreaterThan(0)
  expect(smallDifference.diffPercentage).toBeLessThan(1)

  const zeroTolerance = await compareSvgSnapshot(scatteredChanges, reference, {
    scale: 1,
    tolerance: 0,
  })
  expect(zeroTolerance.matches).toBe(false)

  const horizontalLine =
    `${start}<rect x="10" y="20" width="20" height="1" fill="black"/></svg>`
  const singleRowDifference = await compareSvgSnapshot(horizontalLine, reference, {
    scale: 1,
    tolerance: 0,
  })
  expect(singleRowDifference.diffPercentage).toBeGreaterThan(0)
  expect(singleRowDifference.matches).toBe(false)

  const largeChange = `${start}<rect width="40" height="40" fill="black"/></svg>`
  const largeDifference = await compareSvgSnapshot(largeChange, reference, {
    scale: 1,
    tolerance: 0.01,
  })
  expect(largeDifference.matches).toBe(false)

  const identical = await compareSvgSnapshot(reference, reference, {
    scale: 1,
    tolerance: 0,
  })
  expect(identical.matches).toBe(true)
  expect(identical.diffPercentage).toBe(0)
})
