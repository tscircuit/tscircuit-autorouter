import { createPreparedRoutingFixture } from "tiny-hypergraph/tests/fixtures/createPreparedRoutingFixture"

/** Unused ordinary-incidence region crosses the experiment's dense edge cap. */
export function createIncrementalPathCappedFixture(): ReturnType<typeof createPreparedRoutingFixture> {
  const input = createPreparedRoutingFixture(), t = input.topology, p = input.problem
  const extra = 260, oldPortCount = t.portCount, oldRegionCount = t.regionCount
  const append = (array: ArrayLike<number>, values: number[]): Float64Array => Float64Array.from([...Array.from(array), ...values])
  return {
    topology: {
      ...t, portCount: oldPortCount + extra, regionCount: oldRegionCount + 1,
      regionIncidentPorts: [...t.regionIncidentPorts, Array.from({ length: extra }, (_, i) => oldPortCount + i)],
      incidentPortRegion: [...t.incidentPortRegion, ...Array.from({ length: extra }, () => [oldRegionCount])],
      regionWidth: append(t.regionWidth, [4]), regionHeight: append(t.regionHeight, [4]),
      regionCenterX: append(t.regionCenterX, [1000]), regionCenterY: append(t.regionCenterY, [0]),
      regionAvailableZMask: Int32Array.from([...t.regionAvailableZMask!, 3]),
      portAngleForRegion1: Int32Array.from([...t.portAngleForRegion1, ...new Array<number>(extra).fill(0)]),
      portAngleForRegion2: Int32Array.from([...t.portAngleForRegion2!, ...new Array<number>(extra).fill(0)]),
      portX: append(t.portX, Array.from({ length: extra }, (_, i) => 1000 + i / 1000)),
      portY: append(t.portY, new Array<number>(extra).fill(0)),
      portZ: Int32Array.from([...t.portZ, ...new Array<number>(extra).fill(0)]),
    },
    problem: { ...p, portSectionMask: Int8Array.from([...p.portSectionMask, ...new Array<number>(extra).fill(1)]), regionNetId: Int32Array.from([...p.regionNetId, -1]) },
    options: { ...input.options, MAX_ITERATIONS: 240, RIP_THRESHOLD_RAMP_ATTEMPTS: 100, RIP_THRESHOLD_START: 0, RIP_THRESHOLD_END: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true },
  }
}
