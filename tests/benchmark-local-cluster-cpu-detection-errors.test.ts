import { expect, test } from "bun:test"
import { readLocalCpuTopology } from "../scripts/benchmark/localHighDensityClusterResources"

test("local cluster refuses unknown affinity or unreadable quota rather than guessing CPU capacity", (): void => {
  const files: Record<string, string> = {
    "/proc/self/status": "Cpus_allowed_list:\t4-11\n",
    "/proc/self/cgroup": "0::/benchmark\n",
    "/proc/self/mountinfo":
      "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n",
    "/sys/fs/cgroup/benchmark/cpu.max": "max 100000",
  }
  const readTextFile = (path: string): string | undefined => {
    if (!Object.hasOwn(files, path)) {
      return undefined
    }
    const text = files[path]
    return text
  }
  const options = { platform: "linux" as const, readTextFile }
  expect(readLocalCpuTopology(options)).toEqual({
    affinityCpuIds: [4, 5, 6, 7, 8, 9, 10, 11],
    quotaCpuCount: null,
  })
  expect(() =>
    readLocalCpuTopology({ ...options, platform: "darwin" }),
  ).toThrow("requires Linux")
  files["/proc/self/status"] = "Cpus_allowed_list:\t7-2"
  expect(() => readLocalCpuTopology(options)).toThrow(
    "Invalid Linux CPU affinity range",
  )
  files["/proc/self/status"] = "Name:\tbun"
  expect(() => readLocalCpuTopology(options)).toThrow(
    "Cannot read Linux CPU affinity",
  )
  delete files["/proc/self/status"]
  expect(() => readLocalCpuTopology(options)).toThrow(
    "Cannot determine local benchmark CPU limits",
  )
  files["/proc/self/status"] = "Cpus_allowed_list:\t4-11"
  files["/proc/self/mountinfo"] = ""
  expect(() => readLocalCpuTopology(options)).toThrow(
    "Cannot locate the process CPU cgroup mount",
  )
  files["/proc/self/mountinfo"] =
    "29 23 0:26 /elsewhere /sys/fs/cgroup rw - cgroup2 cgroup rw\n"
  expect(() => readLocalCpuTopology(options)).toThrow(
    "CPU cgroup quota ancestors are hidden",
  )
  const deniedReader = (path: string): string | undefined => {
    if (path.endsWith("cpu.max")) {
      throw new Error("EACCES: quota is unreadable")
    }
    const text = readTextFile(path)
    return text
  }
  files["/proc/self/mountinfo"] =
    "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n"
  expect(() =>
    readLocalCpuTopology({ ...options, readTextFile: deniedReader }),
  ).toThrow("EACCES: quota is unreadable")
})
