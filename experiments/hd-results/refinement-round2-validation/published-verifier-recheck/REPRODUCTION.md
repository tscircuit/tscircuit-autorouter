# Published verifier recheck

The actual full 168-record artifact was re-verified using the path-adapted helpers published at documentation commit `eedd773d4aa422ffac90f304ad3f45a8e4000e4f`. It passed archive completeness, protocol authentication, every raw record and independent summary recomputation. This is a reproducibility check of the published analysis, not another benchmark or a claim about final legal source `365b384…`.

The [original execution record](verification-result.json) identifies the source/run/archive digests; the [compact verifier output](verification-summary.json) retains the complete original output’s SHA-256/size and selected status fields. The raw artifact and full output are not duplicated in this bundle.

To reproduce from the original raw ZIP for Actions run40760310372, check out the published analysis commit and run from the repository root with a fresh output directory:

```sh
python3 experiments/hd-refinements/analysis/verify_refinement_artifact.py artifact.zip --out /tmp/hd-recheck --approved-config experiments/hd-refinements/analysis/approved-configs/confirmation.json --digest 0d4259da268a639616c9e2e369bcc9e929241f3ac35f7eec90a862942cf9af97 --run 40760310372 --head 83a593a901b1209a024ab3a96bb9c191871b8df4
```

This exact command’s arguments identify the authenticated archive/source/config. The original execution record proves the verifier re-execution; it does not claim a shell-command transcript was captured. Later result-only documentation heads are distinct from measured source heads.
