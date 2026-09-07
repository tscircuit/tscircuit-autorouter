import { expect, test } from "bun:test"
import {
  getSrj18DiscoveryRankings,
  type Srj18DiscoveryTrial,
} from "../scripts/iteration-timing/discoverFastestSrj18Sample"

test("SRJ18 discovery ranks successful repeated trials by median and excludes incomplete samples", () => {
  const trials: Srj18DiscoveryTrial[] = []
  for (const [sampleName, times] of [
    ["sample001", [1, 40, 50]],
    ["sample003", [20, 21, 22]],
    ["sample005", [5]],
  ] as const) {
    times.forEach((elapsedTimeMs, index) => {
      trials.push({
        sampleName,
        trialNumber: index + 1,
        wallTimeMs: elapsedTimeMs + 10,
        logPath: "test.log",
        resultPath: "test.json",
        status: "solved",
        elapsedTimeMs,
        iterations: 1,
      })
    })
  }
  trials.push(
    {
      sampleName: "sample005",
      trialNumber: 2,
      wallTimeMs: 90_000,
      logPath: "test.log",
      resultPath: "test.json",
      status: "timed_out",
      timeoutMs: 90_000,
    },
    {
      sampleName: "sample005",
      trialNumber: 3,
      wallTimeMs: 50,
      logPath: "test.log",
      resultPath: "test.json",
      status: "failed",
      elapsedTimeMs: 40,
      error: "Routing failed",
    },
  )
  expect(getSrj18DiscoveryRankings(trials, 3)).toEqual([
    { sampleName: "sample003", medianTimeMs: 21, elapsedTimesMs: [20, 21, 22] },
    { sampleName: "sample001", medianTimeMs: 40, elapsedTimesMs: [1, 40, 50] },
  ])
  expect(
    getSrj18DiscoveryRankings(
      trials.filter((trial) => trial.trialNumber === 1),
      1,
    ).map((ranking) => ranking.sampleName),
  ).toEqual(["sample001", "sample005", "sample003"])
})
