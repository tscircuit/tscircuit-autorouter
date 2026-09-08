import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("static certificate preserves same-net sharing and all combined reservation sentinels independently of endpoint sets", (): void => {
  for (const reservation of [-1, 0, 1, -2]) {
    const capture = createTinyStaticCertificateCapture()
    const native = capture.nativeInstances[0]!
    native.setup.portEndpointReservationNetId[1] = reservation
    native.fixedCopperPortReservations[1] = reservation
    native.problem.regionNetId[1] = 0
    const route = getOnlyTinyStaticRoute(
      createTinyStaticReachabilityCertificate(capture),
    )
    expect(route.status).toBe(
      reservation === -1 || reservation === 0
        ? "connected-in-optimistic-graph"
        : "disconnected-in-optimistic-graph",
    )
    if (reservation === -2) {
      const blockedPort = route.frontierPorts.find(
        (port): boolean => port.portId === 1,
      )
      expect(blockedPort?.physicalReservation).toEqual({
        nativeNetId: -2,
        canonicalNetId: null,
      })
    }
  }
  const foreignRegion = createTinyStaticCertificateCapture()
  foreignRegion.nativeInstances[0]!.problem.regionNetId[1] = 1
  const blocked = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(foreignRegion),
  )
  expect(blocked.frontier).toContainEqual({
    regionId: 0,
    portId: 1,
    nextRegionId: 1,
    reason: "foreign-region-reservation",
  })
})
