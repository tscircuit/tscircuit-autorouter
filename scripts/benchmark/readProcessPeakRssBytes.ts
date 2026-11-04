import { readFileSync } from "node:fs"

/** Linux keeps the process high-water mark even if a brief allocation is freed. */
export const readProcessPeakRssBytes = (
  pid: number | undefined,
): number | undefined => {
  if (process.platform !== "linux" || pid === undefined) return undefined
  let status: string
  try {
    status = readFileSync(`/proc/${pid}/status`, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ESRCH") return undefined
    throw error
  }
  const peak = status.match(/^VmHWM:\s+(\d+)\s+kB$/m)
  if (!peak) return undefined // A process being reaped no longer has an address space.
  return Number(peak[1]) * 1024
}
