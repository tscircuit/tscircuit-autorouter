import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("a one-incident native boundary is a valid dead end while inconsistent listed incidence invalidates the certificate", (): void => {
  const capture = createTinyStaticCertificateCapture()
  const native = capture.nativeInstances[0]!
  native.problem.routeStartPort[0] = 1
  const deadEnd = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(deadEnd.status).toBe("disconnected-in-optimistic-graph")
  expect(deadEnd.frontier[0]?.reason).toBe("no-opposite-region")
  expect(deadEnd.reachedStates).toEqual([[1, 0]])
  native.topology.incidentPortRegion[0] = []
  const malformed = createTinyStaticReachabilityCertificate(capture)
  expect(malformed.status).toBe("unavailable")
  expect(malformed.instances[0]).toMatchObject({
    status: "unsupported-input",
  })
  expect(JSON.stringify(malformed)).toContain("without its reverse incidence")
})
