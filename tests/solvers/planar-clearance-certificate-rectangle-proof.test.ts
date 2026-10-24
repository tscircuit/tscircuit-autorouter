import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import { PlanarClearanceCertificates } from "lib/solvers/HighDensitySolver/PlanarClearanceCertificates"

test("every certified rectangle excludes every inflated obstacle including its full continuum", (): void => {
  let state = 90210
  let accepted = 0
  for (let sceneIndex = 0; sceneIndex < 256; sceneIndex++) {
    const boxes = Array.from({ length: 8 }, (_, index) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const x = state / 2 ** 32 * 8 - 4
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      const y = state / 2 ** 32 * 8 - 4
      return { minX: x, maxX: x + index / 10, minY: y, maxY: y + (8 - index) / 10 }
    })
    const index = new Flatbush(boxes.length)
    for (const box of boxes) index.add(box.minX, box.minY, box.maxX, box.maxY)
    index.finish()
    const certificates = new PlanarClearanceCertificates({
      sceneRevision: 1, z: 0, traceProximity: 0.25, viaProximity: 0.35, segmentClearance: 0.2,
      segments: boxes, segmentIndex: index, vias: [],
    })
    for (let query = 0; query < 20; query++) {
      const center = { x: query / 3 - 3, y: sceneIndex % 11 / 2 - 2.5 }
      const certificate = certificates.findOrCreate(center, 0.1)
      if (!certificate) continue
      accepted++
      expect(center.x >= certificate.minX && center.x <= certificate.maxX).toBe(true)
      expect(center.y >= certificate.minY && center.y <= certificate.maxY).toBe(true)
      for (const box of boxes) {
        // Separation of the entire expanded rectangle proves all contained
        // points and every complete contained segment, including interior.
        expect(
          certificate.maxX + 0.25 < box.minX ||
          certificate.minX - 0.25 > box.maxX ||
          certificate.maxY + 0.25 < box.minY ||
          certificate.minY - 0.25 > box.maxY,
        ).toBe(true)
      }
    }
  }
  expect(accepted).toBeGreaterThan(1000)
})
