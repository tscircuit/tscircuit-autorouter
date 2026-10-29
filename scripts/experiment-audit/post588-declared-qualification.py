"""Run the exact frozen seven-predicate sidecar after official clocks stop."""
import hashlib
import json
import os
import re
import time

CHECKS = {"viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"}
INPUTS = ["original-input.json", "point-pair-context.json", "raw-new-traces.json", "canonical-circuit-json.json"]
COUNTS = ["knownForeignCopperFindingCount", "definiteCopperRuleFindingCount", "unknownCopperFindingCount", "unknownViaCount", "unknownPadCount", "unknownTraceCount"]


def file_hash(path):
    """Bind reports to the exact retained bytes, including formatting."""
    data = path.read_bytes()
    engine = hashlib.sha256()
    engine.update(data)
    result = engine.hexdigest()
    return result


def supported_clean(record):
    value = record.get("declaredIntentCopper") or {}
    valid_status = value.get("status") == "PASS"
    qualified = value.get("qualifiedSupportedCopper") is True
    complete = value.get("ownershipCoverageStatus") == "COMPLETE"
    unchanged = value.get("geometryUnchanged") is True
    return valid_status and qualified and complete and unchanged and not record.get("declaredIntentValidationError")


def validate_compact(record, manifest):
    value = record.get("declaredIntentCopper") or {}
    problems = []
    if not isinstance(value, dict):
        return ["Declared-intent compact report is not an object"]
    checker = value.get("checker") if isinstance(value.get("checker"), dict) else {}
    inputs = value.get("inputHashes") if isinstance(value.get("inputHashes"), dict) else {}
    checks_run = value.get("checksRun")
    if value.get("sidecarSourceSha256") != manifest["declaredIntentSourceSha256"] or checker.get("moduleSha256") != manifest["declaredIntentCheckerSha256"] or checker.get("version") != "0.0.259":
        problems.append("Declared-intent source/checker identity differs")
    if value.get("schemaVersion") != 2 or value.get("allPublishedCopperChecksRun") is not True or not isinstance(checks_run, list) or not all(isinstance(name, str) for name in checks_run) or set(checks_run) != CHECKS or len(checks_run) != 7:
        problems.append("Declared-intent seven-predicate coverage differs")
    if value.get("geometryUnchanged") is not True or value.get("exactRetainedInputBytesVerified") is not True:
        problems.append("Declared-intent geometry/input-byte identity unproven")
    if inputs.get("original-input.json") != record.get("expectedInputHash"):
        problems.append("Declared-intent original input differs")
    digests = [value.get(key) for key in ["canonicalSemanticSha256", "copperGeometrySha256", "reportSha256", "findingInventorySha256"]] + list(inputs.values())
    if set(inputs) != set(INPUTS) or not all(isinstance(item, str) and re.fullmatch(r"[0-9a-f]{64}", item) for item in digests):
        problems.append("Declared-intent input/report/geometry digest population invalid")
    if value.get("canonicalSemanticSha256") != (record.get("supplemental") or {}).get("canonicalCircuitJsonSha256"):
        problems.append("Declared-intent canonical copper differs")
    if value.get("status") not in ["PASS", "FAIL_FOREIGN_CLEARANCE", "FAIL_FOREIGN_COPPER", "FAIL_SUPPORTED_COPPER_RULE", "UNKNOWN_OWNERSHIP"] or type(value.get("qualifiedSupportedCopper")) is not bool:
        problems.append("Declared-intent status/qualification is invalid")
    if any(type(value.get(key)) is not int or value[key] < 0 for key in COUNTS):
        problems.append("Declared-intent finding/coverage counts invalid")
    if value.get("qualifiedSupportedCopper") is not (value.get("status") == "PASS"):
        problems.append("Declared-intent PASS flag contradicts status")
    if supported_clean(record) and any(value.get(key) != 0 for key in COUNTS):
        problems.append("Declared-intent PASS contradicts known/unknown findings")
    obstacle = value.get("originalObstacleCoverage") or {}
    if not isinstance(obstacle, dict) or type(obstacle.get("unmappedDeclaredCopperCount")) is not int or obstacle["unmappedDeclaredCopperCount"] < 0 or (supported_clean(record) and obstacle["unmappedDeclaredCopperCount"] != 0):
        problems.append("Declared-intent explicit original copper coverage invalid")
    return problems


def qualify_output(record, target, checkout, manifest, source_root, execute):
    raw = target / "raw"
    record["declaredIntentCopper"] = None
    record["declaredIntentValidationError"] = None
    record["declaredIntentPostTimingWallMs"] = None
    if not (raw / "canonical-circuit-json.json").exists():
        return
    started = time.monotonic()
    try:
        with (target / "declared-intent-validation.log").open("w") as log:
            command = ["bun", str(source_root / "declared-intent-copper-v3.ts"), str(raw), "--runtime-root", str(checkout)]
            code, timed_out = execute(command, checkout, os.environ.copy(), log, manifest["sampleTimeoutSeconds"])
        if timed_out or code:
            raise ValueError("Declared-intent independent validator " + ("exceeded deadline" if timed_out else f"exited {code}"))
        path = raw / "declared-intent-via-pad.json"
        report = json.loads(path.read_text())
        hashes = {name: file_hash(raw / name) for name in INPUTS}
        if report.get("inputHashes") != hashes:
            raise ValueError("Declared-intent report does not match all four retained input byte hashes")
        compact = {key: report.get(key) for key in ["schemaVersion", "status", "qualifiedSupportedCopper", "ownershipCoverageStatus", "allPublishedCopperChecksRun", "checksRun", "geometryUnchanged", "canonicalSemanticSha256", "copperGeometrySha256", "sidecarSourceSha256", "checker", "inputHashes", *COUNTS]}
        compact["originalObstacleCoverage"] = {key: report.get("originalObstacleCoverage", {}).get(key) for key in ["originalCount", "representedCount", "unmappedCount", "unmappedDeclaredCopperCount"]}
        compact["perCheckCounts"] = {name: {key: report["checks"][name][key] for key in ["count", "knownForeignFindingCount", "unknownFindingCount", "sameOwnerRuleFindingCount"]} for name in sorted(CHECKS)}
        compact.update(exactRetainedInputBytesVerified=True, reportSha256=file_hash(path), findingInventorySha256=hashlib.sha256(json.dumps(report["allFindings"], sort_keys=True, separators=(",", ":")).encode()).hexdigest())
        record["declaredIntentCopper"] = compact
        issues = validate_compact(record, manifest)
        if issues:
            raise ValueError("; ".join(issues))
    except (OSError, ValueError, KeyError, TypeError) as error:
        record["declaredIntentValidationError"] = str(error)
    finally:
        record["declaredIntentPostTimingWallMs"] = (time.monotonic() - started) * 1000
