import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

type RecordEntry = { key: string; hash: string; phase?: string; solved: boolean; failed: boolean }
const [linuxDirectory, macDirectory] = process.argv.slice(2)
if (!linuxDirectory || !macDirectory) throw new Error("Expected Linux and Mac output directories")
const linux: RecordEntry[] = JSON.parse(readFileSync(`${linuxDirectory}/records.json`, "utf8"))
const mac: RecordEntry[] = JSON.parse(readFileSync(`${macDirectory}/records.json`, "utf8"))
for (let index = 0; index < Math.max(linux.length, mac.length); index++) {
  if (JSON.stringify(linux[index]) !== JSON.stringify(mac[index])) {
    console.log("FIRST_REPAIR_DIFFERENCE", JSON.stringify({ index, linux: linux[index], mac: mac[index] }, null, 2))
    throw new Error("Repair observations differ")
  }
}
console.log("All portfolio observations match; comparing final joint output")
const linuxOutput = gunzipSync(readFileSync(`${linuxDirectory}/output.json.gz`)).toString()
const macOutput = gunzipSync(readFileSync(`${macDirectory}/output.json.gz`)).toString()
if (linuxOutput !== macOutput) throw new Error("Mismatch is after the exact repair portfolio")
console.log("Joint repair outputs are identical")
