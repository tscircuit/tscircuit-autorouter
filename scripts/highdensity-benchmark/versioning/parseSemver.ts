import { normalizeVersion } from "./normalizeVersion.ts"

export const parseSemver = (version: string) => {
  const [major = "0", minor = "0", patch = "0"] = normalizeVersion(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10).toString())

  return [Number(major), Number(minor), Number(patch)] as const
}
