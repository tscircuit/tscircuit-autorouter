import { expect, test } from "bun:test"
import {
  planLocalHighDensityClusterResources,
  readLocalCpuTopology,
} from "../scripts/benchmark/localHighDensityClusterResources"

test("local CPU detection applies Linux affinity and every visible cgroup v2 ancestor quota", (): void => {
  const files: Record<string, string> = {
    "/proc/self/status": "Name:\tbun\nCpus_allowed_list:\t2-9,16-31\n",
    "/proc/self/cgroup": "0::/tenant/benchmark\n",
    "/proc/self/mountinfo":
      "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/sys/fs/cgroup/tenant/benchmark/cpu.max": "max 100000\n",
    "/sys/fs/cgroup/tenant/cpu.max": "999999 100000\n",
    "/sys/fs/cgroup/cpu.max": "1600000 100000\n",
  }
  const readTextFile = (path: string): string | undefined => {
    if (!Object.hasOwn(files, path)) {
      return undefined
    }
    const text = files[path]
    return text
  }
  const options = { platform: "linux" as const, readTextFile }
  const topology = readLocalCpuTopology(options)
  expect(topology.affinityCpuIds).toEqual([
    2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    29, 30, 31,
  ])
  expect(topology.quotaCpuCount).toBe(9.99999)
  expect(
    planLocalHighDensityClusterResources({ topology }).effectiveCpuCount,
  ).toBe(9)
  files["/sys/fs/cgroup/tenant/benchmark/cpu.max"] = "750000 100000"
  expect(() =>
    planLocalHighDensityClusterResources({
      topology: readLocalCpuTopology(options),
    }),
  ).toThrow("detected 7")
  files["/proc/self/cgroup"] = "0::/\n"
  files["/proc/self/mountinfo"] =
    "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n"
  files["/sys/fs/cgroup/cpu.max"] = "400000 100000\n"
  expect(readLocalCpuTopology(options).quotaCpuCount).toBe(4)
  files["/proc/self/cgroup"] = "0::/tenant/benchmark\n"
  files["/proc/self/mountinfo"] =
    "29 23 0:26 / /sys/fs/cpu\\040group rw - cgroup2 cgroup rw\n"
  files["/sys/fs/cpu group/tenant/benchmark/cpu.max"] = "max 100000"
  files["/sys/fs/cpu group/tenant/cpu.max"] = "1600000 100000"
  expect(readLocalCpuTopology(options).quotaCpuCount).toBe(16)
  files["/sys/fs/cpu group/tenant/benchmark/cpu.max"] = "broken"
  expect(() => readLocalCpuTopology(options)).toThrow(
    "Invalid cgroup CPU quota",
  )
})
