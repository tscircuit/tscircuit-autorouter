import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("a physical-only reservation closes the full native frontier and retains cut and canonical ownership evidence", (): void => {
  const capture = createTinyStaticCertificateCapture()
  const native = capture.nativeInstances[0]!
  native.topology.regionIncidentPorts = [[0, 1, 2], [1, 2, 3], []]
  native.topology.incidentPortRegion = [[0], [0, 1], [0, 1], [1]]
  native.fixedCopperPortReservations[1] = 1
  native.setup.portEndpointReservationNetId[1] = 1
  native.fixedCopperPortReservations[2] = -2
  native.setup.portEndpointReservationNetId[2] = -2
  expect(native.setup.portEndpointNetIds[1]).toEqual([])
  const before = structuredClone(capture)
  const result = getOnlyTinyStaticRoute(
    createTinyStaticReachabilityCertificate(capture),
  )
  expect(result.status).toBe("disconnected-in-optimistic-graph")
  expect(result.reachedStates).toEqual([[0, 0]])
  expect(result.frontier).toEqual([
    {
      regionId: 0,
      portId: 1,
      nextRegionId: null,
      reason: "foreign-port-reservation",
    },
    {
      regionId: 0,
      portId: 2,
      nextRegionId: null,
      reason: "foreign-port-reservation",
    },
  ])
  const blockedPort = result.frontierPorts.find(
    (port): boolean => port.portId === 1,
  )
  expect(blockedPort).toMatchObject({
    combinedReservation: { nativeNetId: 1, canonicalNetId: "net-b" },
    physicalReservation: { nativeNetId: 1, canonicalNetId: "net-b" },
    endpointNetIds: [],
    metadata: {
      serializedPortId: "port-1",
      data: { physicalCutId: "physical-cut-a", sourcePortPointId: "source-1" },
    },
  })
  expect(result.witness).toBeNull()
  expect(capture).toEqual(before)
})
