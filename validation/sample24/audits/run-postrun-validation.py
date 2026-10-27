#!/usr/bin/env python3
"""Bind current sample24 producer artifacts and preserve every independent audit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

COHORT = {'runId': 40500285904,
 'branch': 'fix/srj24-duplicate-port-bounds-20261027',
 'transportCommit': '5f581d928ed6549091e19d692f0db60b04f01efb',
 'source': '5d5ca622ad436cb0dac518cca5b3d5111c8ecd2d',
 'rootLibTree': 'eb3d7f27006d9eb03d5e99d9570368390090123a',
 'rootPackageBlob': '3c44b8c73131ecb4c5048a0a0ed6a8863328aa32',
 'runtimeReceiptSha256': '959f53b61f8049c5a16d8f3ed1d9b3d9c4927f940a2ce36521aff61704a725e0',
 'runtimeBundleSha256': 'ab9ab8e6ea120318b49f6a09898aa74fdf923e724313ac6561fdaa9d1e448a60',
 'runtimeManifestSha256': '1e3e7eacf346f5fdb5d2f493b1e6c05ca03f78bf126c290d549d869b8c2fa079',
 'originalInputSha256': 'ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7',
 'originalInputCanonicalSha256': '70df1fe5a2ea2ee48e20566a5e2cfad7b34d6c8adb1ff9b30a80d5610e88ace0',
 'artifactNames': ['sample24-final-srj',
                   'sample24-reviewed-runtime-proof',
                   'benchmark-result']}
AUDITOR_MANIFEST_SHA = '407874665a5cda647334ea59f25d92469c1864cff437967f983ec45ccbe7d9c7'
OVERLAY_MANIFEST_SHA = '034a5263be0cff39766f5ed6452735a2c071452b0c3ca75eafe14e2ec773667a'
SOLVER = 'AutoroutingPipelineSolver9_PreloadedTraceGraph'
REQUIRED_ARGS = ['--pipeline', '9', '--dataset', '24', '--sample', '24', '--effort', '1',
                 '--concurrency', '1', '--threads', '1', '--sample-timeout', '7200s']
SUPPORT_FILES = {
    'run-independent-audits.py': 'cbca4cdb6f6f20b858e267289139cce60fc1c46e0c02b55dd5755a833bec9cc6',
    'emit-compact-audit-reports.py': '6d809684066aac3e588aabd888b66972a3871506a224950306d1df39f9e348a5',
}


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def read(path):
    return json.loads(path.read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_run_binding(report):
    require(report.get('binding') == COHORT, 'API producer binding is not the pinned current cohort')
    require(report.get('runId') == COHORT['runId'] and report.get('headSha') == COHORT['transportCommit']
            and report.get('status') == 'completed' and report.get('event') == 'workflow_dispatch'
            and report.get('headBranch') == COHORT['branch']
            and report.get('repositoryFullName') == 'tscircuit/tscircuit-autorouter',
            'API producer run identity/status differs')
    artifacts = report.get('artifacts')
    require(isinstance(artifacts, list) and len(artifacts) == 3
            and {item.get('name') for item in artifacts} == set(COHORT['artifactNames']),
            'Same-run artifact roster differs')
    require(len({item.get('id') for item in artifacts}) == 3, 'Duplicate producer artifact IDs')
    for item in artifacts:
        require(item.get('runId') == COHORT['runId'] and item.get('headSha') == COHORT['transportCommit']
                and type(item.get('id')) is int and item['id'] > 0
                and type(item.get('bytes')) is int and item['bytes'] > 0,
                'Producer artifact belongs to a different or empty run')


def verify_runtime(report, label):
    require(report.get('ready') is True and report.get('kind') == 'REVIEWED_SAMPLE24_BLACKSMITH_RUNTIME',
            label + ' is not a completed runtime verification')
    expected = {'rootSource': COHORT['source'], 'rootLibTree': COHORT['rootLibTree'],
                'localRuntimeReceiptSha256': COHORT['runtimeReceiptSha256'],
                'bundleSha256': COHORT['runtimeBundleSha256'],
                'manifestSha256': COHORT['runtimeManifestSha256']}
    require(all(report.get(key) == value for key, value in expected.items()), label + ' source/bundle differs')
    require(report.get('runtimeSourceFiles') == 218 and report.get('actualNestedImports') == 25
            and report.get('physicalNestedResolutions') == 25 and report.get('bunVersion') == '1.4.3',
            label + ' source/import verification is incomplete')


def verify_input(report, label):
    require(report.get('ready') is True and report.get('kind') == 'ACTUAL_REPOSITORY_BENCHMARK_SAMPLE24_INPUT_PROOF',
            label + ' is not a completed input verification')
    require(report.get('scenarioName') == 'sample024' and report.get('sampleNumber') == 24
            and report.get('effort') == 1 and report.get('originalInputUnchanged') is True,
            label + ' sample/effort differs')
    require(report.get('rawSampleSha256') == COHORT['originalInputSha256']
            and report.get('authoritativeOriginalRawSha256') == COHORT['originalInputSha256']
            and report.get('rawBytesMatchAuthoritativeOriginal') is True,
            label + ' original input bytes differ')
    expected = {'routingFieldsCanonicalSha256': COHORT['originalInputCanonicalSha256'], 'netCount': 409,
                'uniquePcbTerminalCount': 2343, 'obstacleComponentCount': 620, 'obstacleCount': 4418,
                'layerCount': 8, 'minTraceWidth': 0.1, 'allowBlindAndBuriedVias': False}
    require(report.get('routingInputEvidence') == expected and report.get('sourceBoardComponentCount') == 633,
            label + ' original routing fields differ')


def benchmark_status(report):
    # Exact source schema: BenchmarkReport/WorkerResult in scripts/benchmark/benchmark-types.ts.
    require(report.get('version') == 1 and report.get('datasetName') == 'srj24'
            and report.get('scenarioCount') == 1 and report.get('effortLabel') == '1x effort',
            'Benchmark report does not describe this single sample24 effort1 run')
    tests = report.get('tests')
    require(isinstance(tests, list) and len(tests) == 1 and isinstance(tests[0], dict),
            'Exactly one benchmark test is required')
    test = tests[0]
    require(test.get('solverName') == SOLVER and test.get('scenarioName') == 'sample024'
            and test.get('sampleNumber') == 24, 'Benchmark solver/sample differs')
    for key in ['didSolve', 'didTimeout', 'relaxedDrcPassed']:
        require(type(test.get(key)) is bool, 'Benchmark actual boolean status is missing: ' + key)
    count = test.get('drcErrorCount')
    require(count is None or (type(count) is int and count >= 0), 'Invalid benchmark DRC error count')
    if test['relaxedDrcPassed']:
        require(test['didSolve'] and not test['didTimeout'] and count == 0,
                'Benchmark standard DRC pass contradicts solve/timeout/error-count evidence')
    qualified = (test['didSolve'] and not test['didTimeout'] and test['relaxedDrcPassed']
                 and count == 0 and not test.get('error'))
    return {'didSolve': test['didSolve'], 'didTimeout': test['didTimeout'],
            'standardDrcPassed': test['relaxedDrcPassed'], 'standardDrcErrorCount': count,
            'standardDrcErrorTypes': test.get('drcErrorTypes'), 'benchmarkError': test.get('error'),
            'sampleTimeoutMs': test.get('sampleTimeoutMs'), 'qualified': qualified}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--producer-proof-dir', required=True)
    parser.add_argument('--producer-run-binding', required=True)
    parser.add_argument('--routes-dir', required=True)
    parser.add_argument('--benchmark-dir', required=True)
    parser.add_argument('--out-dir', required=True)
    args = parser.parse_args()
    source, proof, out = map(lambda value: Path(value).resolve(),
                             [args.source_root, args.producer_proof_dir, args.out_dir])
    here = Path(__file__).resolve().parent
    git = lambda item: subprocess.check_output(['git', '-C', str(source), 'rev-parse', item], text=True).strip()
    require(not out.exists(), 'Audit output directory must be new')
    run_binding_path = Path(args.producer_run_binding).resolve()
    run_binding = read(run_binding_path)
    verify_run_binding(run_binding)
    require(git('HEAD') == COHORT['transportCommit'] and git('HEAD:lib') == COHORT['rootLibTree']
            and git('HEAD:package.json') == COHORT['rootPackageBlob'],
            'Producer checkout does not match the pinned current transport/source')
    # install-runtime intentionally changes bunfig.toml and generated verification JSONs.
    checked_paths = ['lib', 'package.json', 'scripts/benchmark', 'benchmark.sh',
                     'validation/sample24/runtime-source-manifest.json', 'validation/sample24/verify-input.ts',
                     'validation/sample24/input-semantics.ts', 'validation/sample24/verify-runtime.ts']
    require(subprocess.run(['git', '-C', str(source), 'diff', '--quiet', 'HEAD', '--', *checked_paths]).returncode == 0,
            'Producer tracked source differs from its pinned checkout')
    manifest_path = proof/'runtime-source-manifest.json'
    require(sha(manifest_path) == COHORT['runtimeManifestSha256']
            and sha(source/'validation/sample24/runtime-source-manifest.json') == COHORT['runtimeManifestSha256'],
            'Producer/current checkout manifests are not the current reviewed manifest')
    manifest = read(manifest_path)
    expected = {'rootSource': COHORT['source'], 'rootLibTree': COHORT['rootLibTree'],
                'rootPackageBlob': COHORT['rootPackageBlob'],
                'localRuntimeReceiptSha256': COHORT['runtimeReceiptSha256'],
                'bundleSha256': COHORT['runtimeBundleSha256']}
    require(all(manifest.get(key) == value for key, value in expected.items()), 'Producer source manifest differs')
    require(manifest.get('requiredBenchmarkArgs') == REQUIRED_ARGS, 'Producer benchmark arguments differ')
    require(sha(source/'validation/sample24/runtime-source-bundle.tar.gz') == COHORT['runtimeBundleSha256'],
            'Reviewed runtime archive differs')
    verify_runtime(read(proof/'runtime-verification.json'), 'Producer runtime proof')
    verify_runtime(read(source/'validation/sample24/runtime-verification.json'), 'Fresh checkout runtime reproof')
    input_proof = read(proof/'input-verification.json')
    actual_input_proof = read(source/'validation/sample24/input-verification.json')
    verify_input(input_proof, 'Producer input proof')
    verify_input(actual_input_proof, 'Fresh checkout actual input reproof')
    original = Path(actual_input_proof['rawSamplePath']).resolve()
    require(sha(original) == COHORT['originalInputSha256'], 'Independent original input bytes mismatch')
    benchmark_paths = list(Path(args.benchmark_dir).resolve().rglob('benchmark-result.json'))
    require(len(benchmark_paths) == 1, 'Exactly one same-run benchmark-result.json artifact is required')
    benchmark_path = benchmark_paths[0]
    status = benchmark_status(read(benchmark_path))
    routes = list(Path(args.routes_dir).resolve().rglob('*.srj.json'))
    require(len(routes) == 1 and routes[0].name == SOLVER+'-sample024.srj.json',
            'Exactly one current producer sample24 final SRJ artifact is required')
    routes_sha = sha(routes[0])
    require(sha(here/'auditor-source-manifest.json') == AUDITOR_MANIFEST_SHA, 'Current auditor manifest changed')
    overlay_root = here/'reference-overlay'
    require(sha(overlay_root/'reference-overlay-manifest.json') == OVERLAY_MANIFEST_SHA, 'Current overlay manifest changed')
    overlay_manifest = read(overlay_root/'reference-overlay-manifest.json')
    require(overlay_manifest.get('producerSource') == COHORT['source'] and len(overlay_manifest['files']) == 7,
            'Independent reference overlay belongs to a different producer cohort')
    auditor_manifest = read(here/'auditor-source-manifest.json')
    require(auditor_manifest.get('producerSource') == COHORT['source']
            and auditor_manifest.get('producerTransportCommit') == COHORT['transportCommit']
            and auditor_manifest.get('producerRunId') == COHORT['runId'], 'Independent auditor source cohort differs')
    for item in overlay_manifest['files']:
        require(sha(overlay_root/item['path']) == item['sha256'], 'Independent reference source changed: '+item['path'])
        blob = subprocess.run(['git', '-C', str(source), 'show', 'HEAD:'+item['path']], capture_output=True)
        original_blob_sha = hashlib.sha256(blob.stdout).hexdigest() if blob.returncode == 0 else None
        require(original_blob_sha == item['producerBlobSha256'], 'Reference overlay producer base differs: '+item['path'])
    auditor_files = auditor_manifest['files']
    for item in auditor_files:
        require(sha(here/item['name']) == item['portableSha256'], 'Independent auditor source changed: '+item['name'])
    for name, expected_sha in SUPPORT_FILES.items():
        require(sha(here/name) == expected_sha, 'Independent audit support source changed: '+name)
    audit_root = out.parent/'independent-reference-source'
    require(not audit_root.exists(), 'Independent reference checkout must be new')
    subprocess.run(['git', '-C', str(source), 'worktree', 'add', '--detach', str(audit_root), git('HEAD')], check=True)
    (audit_root/'node_modules').symlink_to(source/'node_modules', target_is_directory=True)
    for item in overlay_manifest['files']:
        destination = audit_root/item['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(overlay_root/item['path'], destination)
    tmp = audit_root/'tmp'
    tmp.mkdir(exist_ok=True)
    for name in [item['name'] for item in auditor_files] + list(SUPPORT_FILES):
        shutil.copyfile(here/name, tmp/name)
    env = dict(os.environ, SAMPLE24_AUDIT_SOURCE_ROOT=str(audit_root), SAMPLE24_AUDIT_ORIGINAL_INPUT=str(original))
    # A failed standard DRC result never skips any independent physical/electrical checks.
    result = subprocess.run([sys.executable, str(tmp/'run-independent-audits.py'), '--routes', str(routes[0]),
                             '--out-dir', str(out)], cwd=audit_root, env=env)
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(benchmark_path, out/'producer-benchmark-result.json')
    shutil.copyfile(run_binding_path, out/'producer-run-binding.json')
    binding = {
        'scope': 'POSTRUN_INDEPENDENT_VALIDATION_ARTIFACT_BINDING_NOT_AUTOMATIC_BOARD_COMPLETION',
        'producerRunId': COHORT['runId'], 'producerRunBindingSha256': sha(run_binding_path),
        'sameRunArtifactProvenance': 'Controller GitHub API run/artifact binding and actions/download-artifact run-id; benchmark schema has no embedded run identity.',
        'producerTransportCommit': git('HEAD'), 'producerRootSource': manifest['rootSource'],
        'producerLibTree': git('HEAD:lib'), 'producerPackageBlob': git('HEAD:package.json'),
        'producerManifestSha256': sha(manifest_path),
        'producerRuntimeProofSha256': sha(proof/'runtime-verification.json'),
        'producerInputProofSha256': sha(proof/'input-verification.json'),
        'checkoutRuntimeReproofSha256': sha(source/'validation/sample24/runtime-verification.json'),
        'checkoutInputReproofSha256': sha(source/'validation/sample24/input-verification.json'),
        'producerBenchmarkReportSha256': sha(benchmark_path), 'producerBenchmarkStatus': status,
        'benchmarkDidSolve': status['didSolve'], 'benchmarkDidTimeout': status['didTimeout'],
        'benchmarkStandardDrcPassed': status['standardDrcPassed'],
        'benchmarkStandardDrcErrorCount': status['standardDrcErrorCount'],
        'benchmarkQualified': status['qualified'],
        'routesSha256': routes_sha, 'routesBytesUnchanged': sha(routes[0]) == routes_sha,
        'inputSha256': sha(original), 'wrapperSha256': sha(Path(__file__)),
        'auditorSourceManifestSha256': sha(here/'auditor-source-manifest.json'),
        'independentReferenceOverlayManifestSha256': sha(overlay_root/'reference-overlay-manifest.json'),
        'independentReferenceFiles': overlay_manifest['files'], 'producerCheckoutUntouchedByReferenceOverlay': True,
        'nativeGeometryCaptureAvailable': False,
        'nativeGeometryQualification': 'No remote Native-state capture required or claimed; final copper is independently audited.',
        'auditRunnerExitCode': result.returncode,
        'qualification': 'Review every physical/electrical count; checker exit zero alone never certifies clearance/completion. Failed standard benchmark DRC makes this job nonpassing and preserves independent reports.',
    }
    (out/'postrun-artifact-binding.json').write_text(json.dumps(binding, indent=2)+'\n')
    compact = subprocess.run([sys.executable, str(tmp/'emit-compact-audit-reports.py'), '--out-dir', str(out)])
    return 1 if result.returncode or compact.returncode or not status['qualified'] or not binding['routesBytesUnchanged'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
