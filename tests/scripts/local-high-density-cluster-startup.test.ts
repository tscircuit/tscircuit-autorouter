import { expect, test } from "bun:test"
import { startLocalHighDensityCluster } from "../../scripts/benchmark/startLocalHighDensityCluster"

test("local cluster refuses insufficient CPU assignments and honors abort before spawning servers", async () => {
  for (const serverCpuIds of [
    [],
    [0],
    Array(8).fill(0),
    [0, 1, 2, 3, 4, 5, 6, -1],
  ]) {
    await expect(
      startLocalHighDensityCluster({
        autorouterVersion: "0.0.968",
        serverCpuIds,
      }),
    ).rejects.toThrow("eight distinct")
  }
  const controller = new AbortController()
  controller.abort(new Error("benchmark cancelled before startup"))
  await expect(
    startLocalHighDensityCluster({
      autorouterVersion: "0.0.968",
      serverCpuIds: [0, 1, 2, 3, 4, 5, 6, 7],
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled before startup")
})
