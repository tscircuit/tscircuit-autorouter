# Manual autorouter previews

Automatic preview suppression is managed in the Vercel dashboard. This change does not add or modify vercel.json. Keep production deployments enabled. Before testing, verify that the dashboard setting permits explicitly requested previews; an Ignored Build Step may skip manual deployments too.

## Request a preview

After this workflow is merged, comment exactly `/preview` on an open PR targeting main.
Only repository users with write, maintain, or admin permission can request one.
For now the PR branch must be in this repository, not a fork.

One GitHub Actions comment reports request received, queued, building, ready (with URL), or failure (with build details).
It always records the exact commit SHA. New pushes do not request another preview.
Repeat `/preview` to preview a newer commit; an active or successful manual preview for the same commit is reused.

Git integration may separately post Vercel's own deployment comment. Our comment is the authoritative status for this command; no dashboard notification setting is changed by this PR.

## One-time configuration

A repository administrator must configure:
- Repository secret `VERCEL_TOKEN`: a credential scoped to the intended tscircuit project/team.
- Repository variable `VERCEL_TEAM_ID`: the tscircuit team ID.
- Repository variable `VERCEL_PROJECT_ID`: the existing capacity-node-autorouter project ID.

No token is committed. Do not put production credentials in the Vercel Preview environment.
Do not request previews for unreviewed code: Vercel runs the requested commit with the project's Preview environment.
The GitHub deployment job never checks out or executes the PR's source, installs dependencies, or runs a shell command with comment contents.
The workflow verifies the requester's live repository permission, rejects fork PRs, pins the head SHA, uses a pinned github-script action, and never requests production deployment or promotion.

## Test before merging

The comment listener and a new workflow_dispatch entry are unavailable until the workflow exists on the default branch.
The PR includes a `pull_request: labeled` entry so the deployment logic can be tested before merging:
1. Review the exact PR commit and workflow.
2. Configure the secret and two variables above.
3. An authorized maintainer creates the `preview-test` label if necessary and applies it to this same-repository PR.
4. Check the Manual Preview workflow and its single PR comment; confirm the commit and URL.
5. Open the preview and inspect the Cosmos debugger.
6. Remove and reapply the label to verify the same ready deployment is reused.

The label triggers only when applied, not on synchronize/push events.
If the PR changes before a queued label request starts, that request fails rather than deploying unreviewed new code.
No merge is needed for this label-driven integration test.
The actual `/preview` issue_comment trigger still needs one post-merge smoke test.
Dashboard preview suppression must be verified separately: an ordinary branch push should not create a hosted preview, while an explicitly requested preview must still build.

A maintainer can also use workflow_dispatch with a PR number after the workflow exists on main.
Existing tests, typechecking, and the GitHub Actions Vercel Build check are unchanged; that check compiles in GitHub Actions and is separate from hosted Vercel build charges.

