import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const configured = process.env.TSCIRCUIT_TS_REFERENCE
if (!configured) throw new Error("Set TSCIRCUIT_TS_REFERENCE to the frozen TypeScript reference checkout")
export const tsReferenceRoot = realpathSync(configured)
const productionRoot = realpathSync(new URL("../../../", import.meta.url))
if (tsReferenceRoot === productionRoot) throw new Error("The TypeScript reference must be a separate checkout")

export async function importReference<T>(path: string): Promise<T> {
  const resolved = resolve(tsReferenceRoot, path)
  if (!resolved.startsWith(`${tsReferenceRoot}/`)) {
    throw new Error("Reference module must be inside the frozen checkout")
  }
  const modulePath = realpathSync(resolved)
  if (modulePath.startsWith(`${productionRoot}/`)) {
    throw new Error("Reference modules must not resolve into the production checkout")
  }
  return await import(pathToFileURL(modulePath).href) as T
}
