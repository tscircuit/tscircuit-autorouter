import { expect, test } from "bun:test"
import { createTinyStaticReachabilityCertificate } from "../../scripts/diagnostics/createTinyStaticReachabilityCertificate"
import {
  createTinyStaticCertificateCapture,
  getOnlyTinyStaticRoute,
} from "../fixtures/createTinyStaticCertificateCapture"

test("static certificate exhausts a path beyond sixteen hops without routing or mutating the captured input", (): void => {
  const capture = createTinyStaticCertificateCapture(24)
  const native = capture.nativeInstances[0]!
  native.problem.routeCount = 3
  native.problem.routeStartPort.push(0, 0)
  native.problem.routeEndPort.push(24, 24)
  native.problem.routeNet.push(0, 0)
  native.problem.routeMetadata.push(
    { connectionId: "unattempted", pcbPortIds: ["a", "b"] },
    { connectionId: "previously-succeeded", pcbPortIds: ["a", "b"] },
  )
  native.routeAttemptCountByRouteId.push(0, 4)
  native.routeSuccessCountByRouteId.push(0, 1)
  const before = structuredClone(capture)
  const result = createTinyStaticReachabilityCertificate(capture)
  const route = getOnlyTinyStaticRoute(result)
  expect(result.status).toBe("complete")
  expect(result.model).toBe("optimistic-static-connectivity")
  expect(result.instances[0]).toMatchObject({
    attemptedNeverSuccessfulCount: 1,
    unattemptedCount: 1,
  })
  expect(route.status).toBe("connected-in-optimistic-graph")
  expect(route.witness).toHaveLength(25)
  expect(route.witness?.[0]).toEqual([0, 0])
  expect(route.witness?.at(-1)).toEqual([24, 23])
  expect(route.reachedStateCount).toBe(24)
  expect(route.reachedStates).toBeNull()
  expect(capture).toEqual(before)
})
