import { readFileSync } from "node:fs"
import { posix } from "node:path"

export const LOCAL_HIGH_DENSITY_SERVER_COUNT = 8

export type LocalCpuTopology = {
  affinityCpuIds: number[]
  quotaCpuCount: number | null
}

export type LocalCpuTopologyReadOptions = {
  platform?: NodeJS.Platform
  readTextFile?: (path: string) => string | undefined
}

export type LocalHighDensityClusterLane = {
  laneId: number
  coordinatorCpuIds: number[]
  serverCpuIds: number[]
}

export type LocalHighDensityClusterResourcePlan = {
  effectiveCpuCount: number
  laneCount: 1 | 2
  lanes: LocalHighDensityClusterLane[]
}

type CpuCgroupMount = {
  root: string
  mountPoint: string
  version: 1 | 2
}

type CpuCgroupMembership = {
  path: string
  version: 1 | 2
}

const readOptionalTextFile = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

const parseCpuAffinity = (status: string): number[] => {
  const cpuList = status.match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1]?.trim()
  if (!cpuList)
    throw new Error("Cannot read Linux CPU affinity from /proc/self/status")
  const cpuIds = new Set<number>()
  for (const part of cpuList.split(",")) {
    const range = part.match(/^(\d+)(?:-(\d+))?$/)
    if (!range) throw new Error(`Invalid Linux CPU affinity range: ${part}`)
    const first = Number(range[1])
    const last = range[2] === undefined ? first : Number(range[2])
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      last < first
    ) {
      throw new Error(`Invalid Linux CPU affinity range: ${part}`)
    }
    for (let cpuId = first; cpuId <= last; cpuId++) cpuIds.add(cpuId)
  }
  return Array.from(cpuIds).sort((left, right): number => left - right)
}

const decodeMountPath = (path: string): string => {
  return path
    .replaceAll("\\040", " ")
    .replaceAll("\\011", "\t")
    .replaceAll("\\012", "\n")
    .replaceAll("\\134", "\\")
}

const parseCpuCgroupMounts = (mountinfo: string): CpuCgroupMount[] => {
  const mounts: CpuCgroupMount[] = []
  for (const line of mountinfo.trim().split("\n")) {
    const [before, after] = line.split(" - ")
    if (!after) continue
    const fields = before.split(" ")
    const [filesystem, , options] = after.split(" ")
    const version =
      filesystem === "cgroup2" ? 2 : filesystem === "cgroup" ? 1 : undefined
    if (!version || (version === 1 && !options?.split(",").includes("cpu")))
      continue
    if (!fields[3] || !fields[4])
      throw new Error("Invalid CPU cgroup mount in /proc/self/mountinfo")
    mounts.push({
      root: decodeMountPath(fields[3]),
      mountPoint: decodeMountPath(fields[4]),
      version,
    })
  }
  return mounts
}

const parseCpuCgroupMemberships = (cgroup: string): CpuCgroupMembership[] => {
  const memberships: CpuCgroupMembership[] = []
  for (const line of cgroup.trim().split("\n")) {
    if (!line) continue
    const firstColon = line.indexOf(":")
    const secondColon = line.indexOf(":", firstColon + 1)
    if (firstColon < 0 || secondColon < 0)
      throw new Error("Invalid /proc/self/cgroup entry")
    const controllers = line.slice(firstColon + 1, secondColon)
    const path = line.slice(secondColon + 1)
    if (!path.startsWith("/")) throw new Error("Invalid /proc/self/cgroup path")
    if (controllers === "") memberships.push({ path, version: 2 })
    else if (controllers.split(",").includes("cpu"))
      memberships.push({ path, version: 1 })
  }
  return memberships
}

const getMountedCgroupDirectory = (
  mount: CpuCgroupMount,
  membership: CpuCgroupMembership,
): string => {
  // A cgroup namespace reports its own root as '/', even when mountinfo names
  // a host subtree (including '/..'). Otherwise account for the mount's root.
  if (membership.path === "/") return mount.mountPoint
  const relativePath = posix.relative(mount.root, membership.path)
  if (relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(
      `Cannot map CPU cgroup ${membership.path} to mount ${mount.mountPoint}`,
    )
  }
  return posix.join(mount.mountPoint, relativePath)
}

const readCpuQuota = (
  directory: string,
  version: 1 | 2,
  readTextFile: (path: string) => string | undefined,
): number | null => {
  if (version === 2) {
    const text = readTextFile(posix.join(directory, "cpu.max"))
    if (text === undefined) return null // CPU controller is absent at this level.
    const parts = text.trim().split(/\s+/)
    const period = Number(parts[1])
    if (parts.length !== 2 || !Number.isFinite(period) || period <= 0) {
      throw new Error(`Invalid cgroup CPU quota in ${directory}/cpu.max`)
    }
    if (parts[0] === "max") return null
    const quota = Number(parts[0])
    if (!Number.isFinite(quota) || quota <= 0)
      throw new Error(`Invalid cgroup CPU quota in ${directory}/cpu.max`)
    return quota / period
  }
  const quotaText = readTextFile(posix.join(directory, "cpu.cfs_quota_us"))
  const periodText = readTextFile(posix.join(directory, "cpu.cfs_period_us"))
  if (quotaText === undefined && periodText === undefined) return null
  const quota = quotaText === undefined ? Number.NaN : Number(quotaText.trim())
  const period =
    periodText === undefined ? Number.NaN : Number(periodText.trim())
  if (
    !Number.isFinite(quota) ||
    !Number.isFinite(period) ||
    period <= 0 ||
    (quota !== -1 && quota <= 0)
  ) {
    throw new Error(`Invalid cgroup CPU quota in ${directory}`)
  }
  return quota === -1 ? null : quota / period
}

export const readLocalCpuTopology = (
  options: LocalCpuTopologyReadOptions = {},
): LocalCpuTopology => {
  if ((options.platform ?? process.platform) !== "linux") {
    throw new Error(
      "The local eight-server benchmark requires Linux CPU affinity and taskset",
    )
  }
  const readTextFile = options.readTextFile ?? readOptionalTextFile
  const status = readTextFile("/proc/self/status")
  const cgroup = readTextFile("/proc/self/cgroup")
  const mountinfo = readTextFile("/proc/self/mountinfo")
  if (status === undefined || cgroup === undefined || mountinfo === undefined) {
    throw new Error(
      "Cannot determine local benchmark CPU limits from Linux /proc",
    )
  }
  const mounts = parseCpuCgroupMounts(mountinfo)
  const memberships = parseCpuCgroupMemberships(cgroup)
  let quotaCpuCount: number | null = null
  for (const membership of memberships) {
    const matchingMounts = mounts.filter(
      (mount): boolean => mount.version === membership.version,
    )
    if (matchingMounts.length === 0)
      throw new Error("Cannot locate the process CPU cgroup mount")
    // A subtree mount hides still-effective parent quotas. Its local 'max'
    // cannot certify that sixteen CPUs are available for two sample lanes.
    const completeMounts = matchingMounts.filter(
      (mount): boolean => mount.root === "/",
    )
    if (completeMounts.length === 0) {
      throw new Error(
        "Cannot verify effective CPU capacity: CPU cgroup quota ancestors are hidden by a subtree mount",
      )
    }
    for (const mount of completeMounts) {
      let directory = getMountedCgroupDirectory(mount, membership)
      while (true) {
        const quota = readCpuQuota(directory, mount.version, readTextFile)
        if (quota !== null)
          quotaCpuCount =
            quotaCpuCount === null ? quota : Math.min(quotaCpuCount, quota)
        if (directory === mount.mountPoint) break
        directory = posix.dirname(directory)
      }
    }
  }
  return { affinityCpuIds: parseCpuAffinity(status), quotaCpuCount }
}

export const planLocalHighDensityClusterResources = ({
  topology,
  concurrency,
}: {
  topology: LocalCpuTopology
  concurrency?: number
}): LocalHighDensityClusterResourcePlan => {
  const cpuIds = [...topology.affinityCpuIds].sort(
    (left, right): number => left - right,
  )
  if (
    cpuIds.some(
      (cpuId): boolean => !Number.isSafeInteger(cpuId) || cpuId < 0,
    ) ||
    new Set(cpuIds).size !== cpuIds.length
  ) {
    throw new Error(
      "Local benchmark CPU affinity must contain distinct nonnegative integer CPU IDs",
    )
  }
  if (
    topology.quotaCpuCount !== null &&
    (!Number.isFinite(topology.quotaCpuCount) || topology.quotaCpuCount <= 0)
  ) {
    throw new Error("Local benchmark CPU quota must be positive or unlimited")
  }
  if (concurrency !== undefined && concurrency !== 1 && concurrency !== 2) {
    throw new Error("Local eight-server benchmark --concurrency must be 1 or 2")
  }
  const effectiveCpuCount = Math.floor(
    Math.min(cpuIds.length, topology.quotaCpuCount ?? cpuIds.length),
  )
  const laneCount = concurrency ?? (effectiveCpuCount >= 16 ? 2 : 1)
  const requiredCpuCount = laneCount * LOCAL_HIGH_DENSITY_SERVER_COUNT
  if (effectiveCpuCount < requiredCpuCount) {
    throw new Error(
      `Local eight-server benchmark needs ${requiredCpuCount} effective CPUs for ${laneCount} sample lane(s), but detected ${effectiveCpuCount} (${cpuIds.length} allowed by affinity; cgroup quota ${topology.quotaCpuCount ?? "unlimited"})`,
    )
  }
  const lanes: LocalHighDensityClusterLane[] = []
  for (let laneId = 0; laneId < laneCount; laneId++) {
    const serverCpuIds = cpuIds.slice(
      laneId * LOCAL_HIGH_DENSITY_SERVER_COUNT,
      (laneId + 1) * LOCAL_HIGH_DENSITY_SERVER_COUNT,
    )
    lanes.push({ laneId, coordinatorCpuIds: [...serverCpuIds], serverCpuIds })
  }
  return { effectiveCpuCount, laneCount, lanes }
}
