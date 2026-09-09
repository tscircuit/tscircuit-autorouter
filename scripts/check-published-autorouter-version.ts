import packageJson from "../package.json" with { type: "json" }

// Resolve the built artifact at runtime so source typechecks need no dist folder.
const { AUTOROUTER_VERSION } = await import(
  new URL("../dist/index.js", import.meta.url).href,
)

if (AUTOROUTER_VERSION !== packageJson.version) {
  throw new Error(
    `Built autorouter version ${AUTOROUTER_VERSION} does not match package version ${packageJson.version}. Rebuild after bumping the version.`,
  )
}
console.log(`Verified published autorouter version ${AUTOROUTER_VERSION}`)
