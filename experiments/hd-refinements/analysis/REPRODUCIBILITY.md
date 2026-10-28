# Reproducing the refinement analysis

These analysis helpers make only the path adaptations recorded in [PORTABILITY.json](PORTABILITY.json). They do not modify the frozen measurement harness. The existing `experiments/hd-refinements/harness` must retain every byte authenticated by `../FROZEN_MANIFEST.json`. All four benchmark profiles have explicit source, order and configuration gates.

The `approved-configs` files are historical exact source-pinned configurations. A later documentation commit does not become the measured source. Download the original Actions raw artifact using the run identified in its results/provenance, retain its ZIP SHA-256, and pass that digest and exact run/head to the verifier. Output directories must be fresh.

```sh
python3 experiments/hd-refinements/analysis/verify_refinement_artifact.py artifact.zip --out /tmp/verified --approved-config experiments/hd-refinements/analysis/approved-configs/portfolio.json --digest ZIP_SHA256 --run RUN_ID --head MEASURED_HEAD
python3 experiments/hd-refinements/analysis/render_refinement_report.py render --profile portfolio --expected-config experiments/hd-refinements/analysis/approved-configs/portfolio.json --artifact-root /tmp/verified/artifact --out /tmp/rendered
```

Substitute the profile/config for each cohort. The legal-only final configuration is independently bound to measured source `365b38451f01c734d3f60628dbd6db14760ca4e6` in `approved-configs/legal-confirmation.json`. The final126 run is complete; later documentation commits are not the measured runtime.

The first legalization raw archive omitted only the non-executing `protocol/.gitignore` because GitHub artifact upload excluded hidden files. Its executable measurement bytes and all 210 records authenticated and its independent summary matched; the verifier deliberately reports `archiveComplete=false` and exits nonzero for the incomplete archive. Never recreate the missing file and describe it as archived evidence.

Published `report-data.tar.gz.b64` files retain all eleven original rendered files byte for byte with member hashes. Their compact CSVs include every sample; the archives are retained despite redundant summary fields so negative cases and exact raw report values stay recoverable. They contain rendered report data, not replacements for the original raw Actions artifacts.

Elapsed/RSS values in correctness checks describe resource bounds, not performance comparisons. Only within-job matched benchmark cohorts support runtime comparisons; do not pool timings across virtual machines. Strict constructor-equal and source-SRJ-equal HD cohorts have different scopes. All censored runs, changed output hashes, downstream failures and manufacturing-rule limits remain material evidence.

## Exact final legal-confirmation cohort

For [run40772916886](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40772916886), use the independently approved legal-only configuration and exact raw artifact SHA-256 `8353966223458c787a600c63075879f3a44e18b43a1e448e5663a067cb574e9b`. An actual full rerun of these public path-adapted helpers authenticated all126 records, archive completeness, protocol bytes and independent summary reconstruction. Choose fresh output paths:

```sh
python3 experiments/hd-refinements/analysis/verify_refinement_artifact.py artifact.zip --out /tmp/hd-final-verified --approved-config experiments/hd-refinements/analysis/approved-configs/legal-confirmation.json --digest 8353966223458c787a600c63075879f3a44e18b43a1e448e5663a067cb574e9b --run 40772916886 --head 365b38451f01c734d3f60628dbd6db14760ca4e6
python3 experiments/hd-refinements/analysis/render_refinement_report.py render --profile legal-confirmation --expected-config experiments/hd-refinements/analysis/approved-configs/legal-confirmation.json --artifact-root /tmp/hd-final-verified/artifact --out /tmp/hd-final-rendered
```

[Source-scoped execution proof](../../hd-results/refinement-round2-validation/published-verifier-recheck/LEGAL_FINAL_REPRODUCTION.md) records this reexecution. Runtime conclusions remain limited to the prespecified within-job cohorts; clean-board outcomes and Bug107 failures remain material.
