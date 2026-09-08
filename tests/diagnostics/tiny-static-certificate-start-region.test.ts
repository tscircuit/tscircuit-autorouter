import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("the certificate selects the native first-free then own starting region instead of seeding every incident region", (): void => {
  const capture = createTinyStaticCertificateCapture()
  const native = capture.nativeInstances[0]!
  native.problem.routeStartPort[0] = 1
  const wrongWay = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(wrongWay.startingRegionId).toBe(0)
  expect(wrongWay.status).toBe("disconnected-in-optimistic-graph")
  expect(wrongWay.frontier).toEqual([
    { regionId: 0, portId: 0, nextRegionId: null, reason: "no-opposite-region" },
  ])
  native.problem.regionNetId[0] = 1
  const rightWay = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(rightWay.startingRegionId).toBe(1)
  expect(rightWay.status).toBe("connected-in-optimistic-graph")
  native.problem.regionNetId[1] = 0
  const ownRegion = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(ownRegion.startingRegionId).toBe(1)
  expect(ownRegion.status).toBe("connected-in-optimistic-graph")
})
