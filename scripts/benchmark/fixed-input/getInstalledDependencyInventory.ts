import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"

export interface InstalledDependency {
  path: string
  name: string
  version: string | null
  packageJsonSha256: string
}

/** Record installed manifests without relying on this repository having a lockfile. */
export const getInstalledDependencyInventory = async (
  repositoryRoot: string,
): Promise<InstalledDependency[]> => {
  const inventory: InstalledDependency[] = []
  const directories = [join(repositoryRoot, "node_modules")]
  while (directories.length > 0) {
    const directory = directories.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && directory !== join(repositoryRoot, "node_modules")) continue
      throw error
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue
      const packageDirectory = join(directory, entry.name)
      if (entry.name.startsWith("@")) {
        directories.push(packageDirectory)
        continue
      }
      const manifestText = await readFile(join(packageDirectory, "package.json"), "utf8")
      const manifest = JSON.parse(manifestText) as { name?: string; version?: string }
      if (!manifest.name) throw new Error(`Installed dependency has no name: ${packageDirectory}`)
      inventory.push({
        path: relative(repositoryRoot, packageDirectory),
        name: manifest.name,
        version: manifest.version ?? null,
        packageJsonSha256: createHash("sha256").update(manifestText).digest("hex"),
      })
      directories.push(join(packageDirectory, "node_modules"))
    }
  }
  return inventory.sort((first, second) => first.path.localeCompare(second.path))
}
