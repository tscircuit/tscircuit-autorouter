import { expect, test } from "bun:test"
import {
  planLocalHighDensityClusterResources,
  type LocalCpuTopology,
} from "../scripts/benchmark/localHighDensityClusterResources"

test("local cluster reserves eight disjoint CPUs per stable sample lane and rejects oversubscription", (): void => {
  const topology: LocalCpuTopology = {
    affinityCpuIds: Array.from(
      { length: 24 },
      (_, index): number => 31 - index,
    ),
    quotaCpuCount: null,
  }
  const cold = planLocalHighDensityClusterResources({ topology })
  const hot = planLocalHighDensityClusterResources({ topology })
  expect(cold).toEqual(hot)
  expect(cold.effectiveCpuCount).toBe(24)
  expect(cold.laneCount).toBe(2)
  expect(cold.lanes.map((lane): number[] => lane.serverCpuIds)).toEqual([
    [8, 9, 10, 11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20, 21, 22, 23],
  ])
  expect(
    new Set(cold.lanes.flatMap((lane): number[] => lane.serverCpuIds)).size,
  ).toBe(16)
  for (const lane of cold.lanes) {
    expect(lane.coordinatorCpuIds).toEqual(lane.serverCpuIds)
    expect(lane.coordinatorCpuIds).not.toBe(lane.serverCpuIds)
  }
  expect(topology.affinityCpuIds[0]).toBe(31)
  expect(
    planLocalHighDensityClusterResources({ topology, concurrency: 1 }).lanes,
  ).toEqual([cold.lanes[0]])
  for (const quotaCpuCount of [8, 8.999, 15.999]) {
    const plan = planLocalHighDensityClusterResources({
      topology: { ...topology, quotaCpuCount },
    })
    expect(plan.laneCount).toBe(1)
    expect(plan.effectiveCpuCount).toBe(Math.floor(quotaCpuCount))
    expect(() =>
      planLocalHighDensityClusterResources({
        topology: { ...topology, quotaCpuCount },
        concurrency: 2,
      }),
    ).toThrow("needs 16 effective CPUs")
  }
  expect(
    planLocalHighDensityClusterResources({
      topology: { ...topology, quotaCpuCount: 16 },
    }).laneCount,
  ).toBe(2)
  expect(() =>
    planLocalHighDensityClusterResources({
      topology: { ...topology, quotaCpuCount: 7.999 },
    }),
  ).toThrow("needs 8 effective CPUs")
  expect(() =>
    planLocalHighDensityClusterResources({
      topology: { affinityCpuIds: [2, 4, 6, 8], quotaCpuCount: 32 },
    }),
  ).toThrow("detected 4")
  for (const concurrency of [0, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      planLocalHighDensityClusterResources({ topology, concurrency }),
    ).toThrow("--concurrency must be 1 or 2")
  }
  for (const quotaCpuCount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      planLocalHighDensityClusterResources({
        topology: { ...topology, quotaCpuCount },
      }),
    ).toThrow("quota must be positive or unlimited")
  }
  for (const affinityCpuIds of [[0, 0], [-1], [1.5], [Number.NaN]]) {
    expect(() =>
      planLocalHighDensityClusterResources({
        topology: { affinityCpuIds, quotaCpuCount: null },
      }),
    ).toThrow("distinct nonnegative integer CPU IDs")
  }
})
