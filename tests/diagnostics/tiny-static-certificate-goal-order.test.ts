import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("the exact goal bypasses section and onward-region checks but another own-net port is not a goal", (): void => {
  const capture = createTinyStaticCertificateCapture()
  const native = capture.nativeInstances[0]!
  native.problem.portSectionMask[3] = 0
  native.setup.portEndpointReservationNetId[1] = 0
  const connected = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(connected.status).toBe("connected-in-optimistic-graph")
  expect(connected.witness?.at(-1)).toEqual([3, 2])
  native.problem.portSectionMask[1] = 0
  const blocked = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(blocked.status).toBe("disconnected-in-optimistic-graph")
  expect(blocked.frontier).toEqual([
    { regionId: 0, portId: 1, nextRegionId: null, reason: "outside-section" },
  ])
  native.problem.portSectionMask[1] = 1
  native.setup.portEndpointReservationNetId[3] = 1
  const forbiddenGoal = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(forbiddenGoal.status).toBe("disconnected-in-optimistic-graph")
  expect(forbiddenGoal.reachedStateCount).toBe(0)
  expect(forbiddenGoal.frontier[0]?.reason).toBe("blocked-goal-reservation")
})
