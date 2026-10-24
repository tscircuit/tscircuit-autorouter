import { expect, test } from "bun:test"
import { createPlanarCertificateFixture } from "./planarCertificateFixture"

test("native search retains the exact route, queue trajectory and logical cap with certificates", (): void => {
  const native = createPlanarCertificateFixture(false)
  const candidate = createPlanarCertificateFixture(true)
  while (!native.solved && !native.failed) {
    native.step()
    candidate.step()
    expect(candidate.iterations).toBe(native.iterations)
    expect(candidate.solved).toBe(native.solved)
    expect(candidate.failed).toBe(native.failed)
    expect(candidate.candidates.peek()).toEqual(native.candidates.peek())
    expect(candidate.exploredNodes).toEqual(native.exploredNodes)
  }
  expect(native.solved).toBe(true)
  expect(candidate.solvedPath).toEqual(native.solvedPath)
  expect(candidate.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
})
