import packageJson from "../../../package.json" with { type: "json" }

/** The exact published autorouter version used to isolate network cache keys. */
export const AUTOROUTER_VERSION = String(packageJson.version)
