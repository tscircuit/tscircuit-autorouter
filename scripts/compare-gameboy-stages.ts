import { readFileSync } from "node:fs"

type Manifest = {
  bun: string
  inputHash: string
  modules: Record<string, string>
  stages: { name: string; hash: string; bytes: number }[]
}

const [linuxDirectory, macDirectory] = process.argv.slice(2)
if (!linuxDirectory || !macDirectory) throw new Error("Expected both artifact directories")
const linux: Manifest = JSON.parse(readFileSync(`${linuxDirectory}/manifest.json`, "utf8"))
const mac: Manifest = JSON.parse(readFileSync(`${macDirectory}/manifest.json`, "utf8"))
if (linux.bun !== mac.bun || linux.inputHash !== mac.inputHash) {
  throw new Error("Bun version or board input differs")
}
const files = new Set([...Object.keys(linux.modules), ...Object.keys(mac.modules)])
for (const file of files) {
  if (linux.modules[file] !== mac.modules[file]) throw new Error(`Module differs: ${file}`)
}
if (linux.stages.length !== mac.stages.length) throw new Error("Stage counts differ")
for (let index = 0; index < linux.stages.length; index++) {
  const expected = linux.stages[index]
  const actual = mac.stages[index]
  console.log(JSON.stringify({ index, linux: expected, mac: actual }))
  if (expected.name !== actual.name || expected.hash !== actual.hash) {
    throw new Error(`First differing input: ${expected.name}; preceding stage: ${linux.stages[index - 1]?.name}`)
  }
}
if (readFileSync(`${linuxDirectory}/final.json`, "utf8") !== readFileSync(`${macDirectory}/final.json`, "utf8")) {
  throw new Error("Final output differs despite matching stage inputs")
}
