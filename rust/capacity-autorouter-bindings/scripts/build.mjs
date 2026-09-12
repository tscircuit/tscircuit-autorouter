import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = `${root}Cargo.toml`
const bindgen = process.env.WASM_BINDGEN ?? "wasm-bindgen"
const lockfile = readFileSync(`${root}Cargo.lock`, "utf8")
const version = lockfile.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1]
if (!version) throw new Error("Cargo.lock does not pin wasm-bindgen")
const installed = execFileSync(bindgen, ["--version"], { encoding: "utf8" }).trim()
if (installed !== `wasm-bindgen ${version}`) {
  throw new Error(`Expected wasm-bindgen ${version}; run cargo install wasm-bindgen-cli --version ${version} --locked`)
}

execFileSync("cargo", ["build", "--manifest-path", manifest, "--target-dir", `${root}target`, "--locked", "--target", "wasm32-unknown-unknown", "--release"], { stdio: "inherit" })
execFileSync(bindgen, [
  `${root}target/wasm32-unknown-unknown/release/capacity_autorouter_bindings.wasm`,
  "--target", "web", "--typescript", "--out-dir", `${root}pkg`,
], { stdio: "inherit" })
