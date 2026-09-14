# GitHub verification

Updated 13 September 2026. Repository settings below were read back through GitHub CLI/API. Workflow source alone is not evidence of a passing run; the release follow-up records actual run links.

`.github/workflows/ci.yml` runs on pushes to `main`, pull requests and manual dispatch. The stable job name for a required status check is **Verify**. It uses Node **24.19.0**, pnpm **11.19.0**, the frozen lockfile, type checking, all TypeScript and server test files, a disposable PostgreSQL **18** service, and separate local/cloud build directories in the runner’s temporary storage. Server tests also use the `tsx` loader because some fixtures import TSX. The PostgreSQL suite creates and drops a random local test database and rejects remote database URLs.

The Verify job has only `contents: read`, does not persist checkout credentials, and has no production secrets, deployment steps, cache sharing or `pull_request_target` execution. It uploads the verified cloud build as a 14-day artifact. A separate provenance job, restricted to successful main pushes, has `id-token: write` and `attestations: write` to sign the public build manifest; pull-request code has no signing permissions. The PostgreSQL password in the file is a public, disposable test credential. All actions are pinned to release-associated commit SHAs, verified through the official repositories’ GitHub API; the pnpm annotated tag was resolved to its underlying commit:

| Action | Verified release | Commit |
| --- | --- | --- |
| actions/checkout | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | [v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) | `820762786026740c76f36085b0efc47a31fe5020` |
| pnpm/action-setup | [v6.1.0](https://github.com/pnpm/action-setup/releases/tag/v6.1.0) | `ea17c68df8912ef543352723c149a84f56e3d413` |

Dependabot checks root npm/pnpm dependencies and GitHub Actions weekly. The pnpm configuration correctly uses the `npm` ecosystem. **The current GitHub support table lists pnpm 7–10, while this project uses pnpm 11.19.0 and lockfile version 9.0.** The first update job must therefore be inspected before claiming pnpm 11 lockfile updates work. If the updater cannot resolve this version, maintain dependencies with the pinned pnpm locally, commit the resulting lockfile and require Verify before merging; do not silently downgrade or regenerate the lockfile with npm. Actions commit pins and matching release comments are supported update targets. [GitHub ecosystem support](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)

The repository main branch now requires a pull request, a current **Verify** result, linear history and resolved review conversations. Admins are included; force pushes and branch deletion are disabled. As a solo-maintainer repository the minimum approving-review count is zero: this does not claim a second human reviewed every merge.

CodeQL default setup is configured for JavaScript/TypeScript with the extended query suite (setup run 34804546906 succeeded). Dependabot alerts, security updates, secret scanning, push protection and private vulnerability reporting were enabled. Default Actions token access is read-only, and Actions cannot approve pull requests. GitHub account MFA is a separate account control, not something these settings prove.

Heroku automatically deploys main after a merge. Its **Wait for GitHub checks to pass before deploy** option was read back as checked after reloading the deployment settings. The CI workflow itself has no Heroku credentials or deployment step. Inspect the first Verify run including PostgreSQL tests and both builds, then verify the deployed manifest and assets against that commit. A signed CI manifest is evidence about that CI build, not a guarantee against an operator replacing live responses later. [GitHub PostgreSQL service documentation](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)

## Build provenance

The build uses [Heroku SOURCE_VERSION](https://devcenter.heroku.com/articles/buildpack-api) or the checked Git commit, a frozen pnpm lockfile, a fixed Node major and explicit cloud base/edition. `build-info.json` contains only a public allowlist; no config vars or database credentials are included. CI builds twice and requires identical metadata/files. Download the CI artifact and verify its manifest with `gh attestation verify build-info.json --repo Treeezheng/drug-tracker`. Compare its asset hashes with the served files; a production manifest is not itself trusted proof.

Additional official action pins verified for this release: upload-artifact v4 `ea165f8d65b6e75b540449e92b4886f43607fa02`; download-artifact v4 `d3f86a106a0bac45b974a628896c90dbdf5c8093`; attest-build-provenance v3 `43d14bc2b83dec42d39ecae14e916627a18bb661`. [GitHub artifact attestation documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations).
