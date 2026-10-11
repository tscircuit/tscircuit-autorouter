import { expect, test } from "bun:test"
import { readLocalCpuTopology } from "../scripts/benchmark/localHighDensityClusterResources"

test("a locally unlimited cgroup cannot authorize two lanes when a hidden ancestor may limit CPU capacity", (): void => {
  const files: Record<string, string> = {
    "/proc/self/status": "Cpus_allowed_list:\t0-15\n",
    "/proc/self/cgroup": "0::/\n",
    "/proc/self/mountinfo": "29 23 0:26 /.. /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/sys/fs/cgroup/cpu.max": "max 100000",
  }
  const readTextFile = (path: string): string | undefined => {
    if (!Object.hasOwn(files, path)) {
      return undefined
    }
    const text = files[path]
    return text
  }
  const options = { platform: "linux" as const, readTextFile }
  expect(() => readLocalCpuTopology(options)).toThrow("CPU cgroup quota ancestors are hidden")
  files["/proc/self/cgroup"] = "4:cpu:/tenant/benchmark\n"
  files["/proc/self/mountinfo"] = "29 23 0:26 /tenant /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu\n"
  expect(() => readLocalCpuTopology(options)).toThrow("CPU cgroup quota ancestors are hidden")
  files["/proc/self/mountinfo"] += "30 23 0:27 / /full/cpu rw - cgroup cgroup rw,cpu\n"
  files["/full/cpu/tenant/benchmark/cpu.cfs_quota_us"] = "-1"
  files["/full/cpu/tenant/benchmark/cpu.cfs_period_us"] = "100000"
  files["/full/cpu/tenant/cpu.cfs_quota_us"] = "400000"
  files["/full/cpu/tenant/cpu.cfs_period_us"] = "100000"
  expect(readLocalCpuTopology(options).quotaCpuCount).toBe(4)
})
