import { AUTOROUTER_VERSION } from "../dist/index.js"
import packageJson from "../package.json" with { type: "json" }

if (AUTOROUTER_VERSION !== packageJson.version) {
  throw new Error(
    `Built autorouter version ${AUTOROUTER_VERSION} does not match package version ${packageJson.version}. Rebuild after bumping the version.`,
  )
}
console.log(`Verified published autorouter version ${AUTOROUTER_VERSION}`)
