import { expect, test } from "bun:test"
import {
  planLocalHighDensityClusterResources,
  readLocalCpuTopology,
} from "../scripts/benchmark/localHighDensityClusterResources"

test("local CPU detection supports hierarchical cgroup v1 and the stricter limit on hybrid hosts", (): void => {
  const files: Record<string, string> = {
    "/proc/self/status": "Cpus_allowed_list:\t0-31\n",
    "/proc/self/cgroup": "4:cpu,cpuacct:/tenant/work\n3:memory:/tenant/work\n",
    "/proc/self/mountinfo": "30 23 0:27 / /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu,cpuacct\n",
    "/sys/fs/cgroup/cpu/tenant/work/cpu.cfs_quota_us": "-1\n",
    "/sys/fs/cgroup/cpu/tenant/work/cpu.cfs_period_us": "100000\n",
    "/sys/fs/cgroup/cpu/tenant/cpu.cfs_quota_us": "1649999\n",
    "/sys/fs/cgroup/cpu/tenant/cpu.cfs_period_us": "100000\n",
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
  expect(topology.quotaCpuCount).toBe(16.49999)
  expect(planLocalHighDensityClusterResources({ topology }).laneCount).toBe(2)
  files["/proc/self/cgroup"] += "0::/tenant/work\n"
  files["/proc/self/mountinfo"] += "31 23 0:28 / /sys/fs/cgroup/unified rw - cgroup2 cgroup rw\n"
  files["/sys/fs/cgroup/unified/tenant/work/cpu.max"] = "800000 100000"
  files["/sys/fs/cgroup/unified/tenant/cpu.max"] = "max 100000"
  expect(readLocalCpuTopology(options).quotaCpuCount).toBe(8)
  expect(planLocalHighDensityClusterResources({ topology: readLocalCpuTopology(options) }).laneCount).toBe(1)
  delete files["/sys/fs/cgroup/unified/tenant/work/cpu.max"]
  files["/sys/fs/cgroup/cpu/tenant/work/cpu.cfs_quota_us"] = "799999"
  expect(() => planLocalHighDensityClusterResources({ topology: readLocalCpuTopology(options) })).toThrow("detected 7")
  delete files["/sys/fs/cgroup/cpu/tenant/work/cpu.cfs_period_us"]
  expect(() => readLocalCpuTopology(options)).toThrow("Invalid cgroup CPU quota")
  delete files["/sys/fs/cgroup/cpu/tenant/work/cpu.cfs_quota_us"]
  files["/sys/fs/cgroup/cpu/tenant/cpu.cfs_quota_us"] = "-1"
  expect(readLocalCpuTopology(options).quotaCpuCount).toBeNull()
})
