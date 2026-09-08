import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import { createTinyStaticCertificateCapture } from "../fixtures/createTinyStaticCertificateCapture"

test("unknown capture data and seeds are never interpreted as free topology or empty reservations", (): void => {
  const capture = createTinyStaticCertificateCapture()
  const native = capture.nativeInstances[0]!
  const invalidInstances: unknown[] = [
    { ...native, nativeSolverClass: "UnknownSolver" },
    { ...native, setup: null },
    { ...native, setupStatus: "unavailable-not-retained-or-not-computed" },
    { ...native, fixedCopperPortReservations: null },
    { ...native, initialAssignmentsStatus: undefined },
    {
      ...native,
      problem: { ...native.problem, initialAssignments: null },
    },
    {
      ...native,
      problem: { ...native.problem, initialAssignments: [{ routeId: 0 }] },
    },
    {
      ...native,
      topology: { ...native.topology, portX: [NaN, 1, 2, 3] },
    },
    {
      ...native,
      topology: {
        ...native.topology,
        incidentPortRegion: [[], [0, 1], [1, 2], [2]],
        regionIncidentPorts: [[1], [1, 2], [2, 3]],
      },
    },
  ]
  for (const invalid of invalidInstances) {
    const result = createTinyStaticReachabilityCertificate({
      ...capture,
      nativeInstances: [invalid],
    })
    expect(result.status).toBe("unavailable")
    expect(result.instances[0]).toMatchObject({ status: "unsupported-input" })
  }
  expect(createTinyStaticReachabilityCertificate(null).status).toBe("unavailable")
  native.initialAssignmentsStatus = "absent-optional-native-field"
  native.problem.initialAssignments = null
  expect(createTinyStaticReachabilityCertificate(capture).status).toBe("complete")
})
