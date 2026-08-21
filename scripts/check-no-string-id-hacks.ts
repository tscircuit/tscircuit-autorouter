import { spawnSync } from "node:child_process";

export type AddedLine = {
  file: string;
  line: number;
};

export type StringIdPrefixHack = {
  prefix: string;
  startLine: number;
  endLine: number;
};

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const getLineNumber = (source: string, index: number): number =>
  source.slice(0, index).split("\n").length;

const isInsideComment = (source: string, index: number): boolean => {
  const beforeMatch = source.slice(0, index);
  const currentLine = beforeMatch.slice(beforeMatch.lastIndexOf("\n") + 1);
  if (currentLine.trimStart().startsWith("//")) return true;

  return beforeMatch.lastIndexOf("/*") > beforeMatch.lastIndexOf("*/");
};

export const findStringIdPrefixHacks = (
  source: string,
): StringIdPrefixHack[] => {
  const findings: StringIdPrefixHack[] = [];
  const hardCodedPrefixPattern =
    /\.startsWith\s*\(\s*(["'`])([^"'`\r\n]*_[^"'`\r\n]*)\1/g;

  for (const match of source.matchAll(hardCodedPrefixPattern)) {
    if (match.index === undefined || isInsideComment(source, match.index))
      continue;
    const prefix = match[2]!;
    if (prefix.includes("${")) continue;

    findings.push({
      prefix,
      startLine: getLineNumber(source, match.index),
      endLine: getLineNumber(source, match.index + match[0].length),
    });
  }

  return findings;
};

export const getAddedProductionLines = (diff: string): AddedLine[] => {
  const addedLines: AddedLine[] = [];
  let currentFile = "";
  let currentNewLine = 0;

  for (const diffLine of diff.split("\n")) {
    if (diffLine.startsWith("+++ b/")) {
      currentFile = diffLine.slice("+++ b/".length);
      continue;
    }

    const hunk = diffLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      currentNewLine = Number(hunk[1]);
      continue;
    }

    if (diffLine.startsWith("+") && !diffLine.startsWith("+++")) {
      if (/^lib\/.*\.[cm]?[jt]sx?$/.test(currentFile)) {
        addedLines.push({ file: currentFile, line: currentNewLine });
      }
      currentNewLine += 1;
    } else if (!diffLine.startsWith("-") && !diffLine.startsWith("\\")) {
      currentNewLine += 1;
    }
  }

  return addedLines;
};

const getAddedLines = (baseSha: string, headSha: string): AddedLine[] => {
  const diff = spawnSync(
    "git",
    ["diff", "--unified=0", "--no-ext-diff", baseSha, headSha, "--", "lib"],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) {
    throw new Error(diff.stderr || "git diff failed");
  }

  return getAddedProductionLines(diff.stdout);
};

const getFileAtRevision = (revision: string, file: string): string => {
  const result = spawnSync("git", ["show", `${revision}:${file}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to read ${file} at ${revision}`);
  }
  return result.stdout;
};

const escapeAnnotation = (value: string): string =>
  value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const main = (): void => {
  const [rawBaseSha, headSha] = process.argv.slice(2);
  if (!rawBaseSha || !headSha) {
    throw new Error(
      "Usage: bun scripts/check-no-string-id-hacks.ts <base-sha> <head-sha>",
    );
  }

  const baseSha = /^0+$/.test(rawBaseSha) ? EMPTY_TREE_SHA : rawBaseSha;
  const addedLinesByFile = new Map<string, Set<number>>();
  for (const addedLine of getAddedLines(baseSha, headSha)) {
    const lines = addedLinesByFile.get(addedLine.file) ?? new Set<number>();
    lines.add(addedLine.line);
    addedLinesByFile.set(addedLine.file, lines);
  }

  let findingCount = 0;
  for (const [file, addedLines] of addedLinesByFile) {
    const source = getFileAtRevision(headSha, file);
    for (const finding of findStringIdPrefixHacks(source)) {
      const touchesAddedLine = [...addedLines].some(
        (line) => line >= finding.startLine && line <= finding.endLine,
      );
      if (!touchesAddedLine) continue;

      findingCount += 1;
      const message =
        `Do not infer a circuit entity's type from the hard-coded ID prefix ` +
        `\"${finding.prefix}\". Use explicit metadata or a discriminated union instead.`;
      console.error(
        `::error file=${escapeAnnotation(file)},line=${finding.startLine},title=String ID hack::${escapeAnnotation(message)}`,
      );
    }
  }

  if (findingCount > 0) {
    console.error(
      `Found ${findingCount} newly added hard-coded string ID prefix check(s).`,
    );
    process.exit(1);
  }

  console.log("No newly added string ID prefix hacks found.");
};

if (import.meta.main) main();
