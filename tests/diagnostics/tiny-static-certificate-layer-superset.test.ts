import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("single-layer metadata does not invent a hard layer-changing edge rejection in the optimistic native graph", (): void => {
  const capture = createTinyStaticCertificateCapture(2)
  const native = capture.nativeInstances[0]!
  native.topology.portZ = [0, 1, 1]
  native.topology.regionAvailableZMask = [1, 1]
  const before = structuredClone(capture)
  const result = createTinyStaticReachabilityCertificate(capture)
  const route = getOnlyTinyStaticRoute(result)
  expect(result.model).toBe("optimistic-static-connectivity")
  expect(route.status).toBe("connected-in-optimistic-graph")
  expect(route.witness).toEqual([
    [0, 0],
    [1, 1],
    [2, 1],
  ])
  expect(result.limitations).toContain(
    "Layer masks are reported, not promoted into a new native hard edge predicate.",
  )
  expect(capture).toEqual(before)
})
