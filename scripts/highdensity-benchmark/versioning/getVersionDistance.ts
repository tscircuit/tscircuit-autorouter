import { parseSemver } from "./parseSemver.ts"

export const getVersionDistance = (left: string, right: string) => {
  const [leftMajor, leftMinor, leftPatch] = parseSemver(left)
  const [rightMajor, rightMinor, rightPatch] = parseSemver(right)

  // Weight major/minor differences more heavily than patch differences.
  return (
    Math.abs(leftMajor - rightMajor) * 1_000_000 +
    Math.abs(leftMinor - rightMinor) * 1_000 +
    Math.abs(leftPatch - rightPatch)
  )
}
