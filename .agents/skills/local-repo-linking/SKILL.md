---
name: local-repo-linking
description: Clone dependency repositories into a local vendor folder and link them into a project for live local development. Use when the user asks to clone, vendor, locally link, `bun link`, `npm link`, replace a git/npm dependency with a local checkout, or use `.vdner`, `.vendor`, `.vender`, or `.vendero` folders.
---

# Local Repo Linking

Use this skill to make an installed dependency resolve from a local checkout, usually under `.vdner/<repo-name>`, so edits in the dependency can be tested from the main project.

## Workflow

1. Inspect the project first:
   - Read `package.json` and the lockfile to identify the package manager.
   - Search imports and dependency specs for the package name.
   - Check existing vendor folder conventions: `.vdner`, `.vendor`, `.vender`, `.vendero`.
   - Prefer the user-specified folder. If none is specified, use an existing convention; otherwise default to `.vdner`.

2. Clone the dependency:
   - Create the vendor folder if missing.
   - Clone to `.vdner/<repo-name>` or the chosen vendor folder.
   - If replacing a pinned dependency, record the old commit/tag before changing it.
   - If the user asked for a specific ref, check it out after cloning.

3. Confirm package identity:
   - Open the dependency `package.json`.
   - The `name` must match the package being linked.
   - Add a local-only `version` only if the package manager requires one for linking.
   - If two dependency names point at the same repo, do not assume one checkout can satisfy both. For Bun, create a second checkout or small wrapper package with a distinct `package.json.name`.

4. Link with the project package manager:
   - Bun live link:
     ```bash
     cd .vdner/package-name
     bun link
     cd ../..
     bun link package-name
     ```
     In the root `package.json`, use `"package-name": "link:package-name"`.
   - Bun local file copy only when live linking is not required:
     ```json
     "package-name": "file:./.vdner/package-name"
     ```
   - npm live link:
     ```bash
     cd .vdner/package-name
     npm link
     cd ../..
     npm link package-name
     ```
   - pnpm/yarn: prefer the package manager's native `link:` or `workspace:` style only after confirming the repo already uses it.

5. Validate the link:
   - Run the install/link command and read the output.
   - Verify `node_modules/<package>` points at the vendor checkout:
     ```bash
     ls -ld node_modules/package-name
     readlink -f node_modules/package-name
     ```
   - Run a direct import check when possible:
     ```bash
     bun -e 'await import("package-name")'
     ```
   - Run the repo's focused build or test command, respecting local `AGENTS.md` validation policy.

## Editing Rules

- Do not format or lint unless the repo instructions request it.
- Do not delete or revert existing user changes.
- Add the vendor folder to `.gitignore` only when the project treats vendored checkouts as local-only. If the user wants the vendored source reviewed, leave it trackable.
- Keep dependency changes scoped to the requested packages and lockfiles.
- Report whether the final setup is a live symlink or a copied `file:` dependency.
