---
description: Prepare @keenmate/web-components-core for npm publish — bump version, finalize CHANGELOG, verify, build, commit
argument-hint: rc|release|patch|minor|major
---

# /publish — prepare an npm release of @keenmate/web-components-core

You are preparing this package for publish. **Do not run `npm publish`** and **do not push** — the
user ships manually afterward (via `make publish-rc` / `make publish`, which prompt and then publish).

This mirrors web-multiselect's `/publish`, adapted for this repo. Where the two differ it is because
core has a different layout (a `tsc`-built library with a Keep-a-Changelog `## [Unreleased]` section and
no published README), NOT because the process is looser. This core is depended on by web-multiselect /
web-daterangepicker / web-treeview, so the verify gate is non-negotiable.

## Argument

The release type: **$ARGUMENTS**

Must be one of:

- `rc` — ship a pre-release. `CURRENT_VERSION` must already be `X.Y.Z-rcN` (bumped when the rc cycle
  opened); `NEW_VERSION = CURRENT_VERSION` (no bump). If `CURRENT_VERSION` is not an rc, **stop and ask** —
  they probably want `release`/`patch`/`minor`/`major`, or need to pick the rc target version first.
- `release` — promote a WIP rc to a final release. `X.Y.Z-rcN` → `X.Y.Z`. If `CURRENT_VERSION` is not an
  rc, stop.
- `patch` — SemVer patch bump. Strips any `-rcN` first.
- `minor` — SemVer minor bump. Strips `-rcN`, resets patch.
- `major` — SemVer major bump. Strips `-rcN`, resets minor and patch.

If missing or invalid, stop and ask the user which one to use (don't guess).

## Repo layout

Single-package library, everything at root:

- **`./package.json`** — `version` is the source of truth. Currently pre-1.0.
- **`./CHANGELOG.md`** — Keep-a-Changelog style with a **`## [Unreleased]`** section at the top holding
  WIP entries under `### Added` / `### Changed` / `### Fixed` / etc. Released versions sit below as
  `## [X.Y.Z] - YYYY-MM-DD`.
- **`./dist/`** — gitignored. Produced by `npm run build` (`tsc -p tsconfig.build.json` → ESM + `.d.ts`).
  Never staged.
- **Published `files`:** `dist`, `SPEC.md`, `docs` (see `package.json`). The README is **not** published,
  so there is no README "What's New" flow here — skip anything about it.
- **Subpath exports:** `.`, `./testing`, `./cem`, `./positioning` — each must resolve to a built file
  under `dist/` after a build.

## Resolve versions

Read `./package.json` `version` as `CURRENT_VERSION`. Compute `NEW_VERSION` per the argument table above.

## Steps (in order)

### 1. Sanity checks

- Run `git status`. `.claude/` and local artifacts staying untracked is fine. If there are **other**
  uncommitted changes outside `CHANGELOG.md` / `package.json`, list them and ask the user before
  continuing — substantive source changes belonging in this release should be committed (with their own
  descriptive commits) first.
- **Verify the target version isn't already published:** `npm view @keenmate/web-components-core@<NEW_VERSION> version 2>/dev/null`.
  If it returns the version, **stop** — re-publishing the same version fails and pollutes the commit.
- **Verify the registry hasn't drifted past you:** `npm view @keenmate/web-components-core version` (the
  current `latest`). If it's higher than `NEW_VERSION`, warn and ask before continuing.
- Confirm `## [Unreleased]` has at least one substantive bullet under `### Added` / `### Changed` /
  `### Removed` / `### Fixed`. If it's empty, **stop** — there's nothing to release.

### 2. Bump version (if needed)

If `NEW_VERSION` ≠ `CURRENT_VERSION`, edit `./package.json` `"version"`. For `rc` this is normally a no-op.

### 3. Finalize CHANGELOG

In `./CHANGELOG.md`, convert the WIP `## [Unreleased]` into the released section:

- Rename `## [Unreleased]` to `## [NEW_VERSION] - YYYY-MM-DD` (today's date from system context).
- Leave all bullet content untouched.
- Insert a fresh empty `## [Unreleased]` heading **above** the just-finalized section, so the next dev
  cycle has somewhere to write. (This is the Keep-a-Changelog convention — the OPPOSITE of
  web-multiselect's, which has no Unreleased section. Don't copy that repo's "do not create a new WIP
  section" rule here.)

### 4. Validate CHANGELOG entries match recent work

Find the previous released heading (`## [X.Y.Z] - …`) and the commit that shipped it (subject usually
starts with `vX.Y.Z` or `release`), then `git log --oneline <that-commit>..HEAD`. For every substantive
commit or uncommitted change, confirm the finalized section mentions it. If something significant is
missing, **stop and ask** — don't invent entries. Pure doc/example tweaks and trivial fixes don't need
entries.

### 5. Verify (the gate)

Run `npm run typecheck` then `npm test` (or `make verify`). Both must be clean. If anything fails,
**stop and report** — do not build or commit. This gate is what keeps a broken core off the registry
that three components depend on.

### 6. Build

Run `npm run build` (or `make build`) — `npm run clean:dist` then `tsc -p tsconfig.build.json`. If it
errors, stop and report. Then smoke-check the emitted entry points for every export map subpath:

- `dist/index.js` + `dist/index.d.ts`
- `dist/testing/index.js` + `.d.ts`
- `dist/cem/index.js` + `.d.ts`
- `dist/positioning/index.js` + `.d.ts`

All must exist and be non-empty.

### 7. Verify the package contents

Run `npm pack --dry-run` (or `make publish-dry`, which also cleans+builds first). Confirm the file list
includes `dist/` (JS + `.d.ts`), `SPEC.md`, `docs/`, and `package.json`. If anything private leaked in
(`src/`, `*.test.ts`, `tsconfig*.json`, `Makefile`), **stop and report** — the `files` field controls
this and the leak needs fixing before publish.

### 8. Commit

Stage only:

- `./CHANGELOG.md`
- `./package.json`

Do **not** stage `dist/` (gitignored). Commit message:

```
vNEW_VERSION - <one-line summary of the headline change>

<grouped bullets paraphrased from the finalized CHANGELOG section — Added / Fixed /
Changed / Internal, as applicable. Terse; full prose lives in the CHANGELOG.>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

### 9. Report

Report back with:

- `NEW_VERSION` and the commit SHA.
- The exact publish command, picked for the arg:
  - `rc` → `make publish-rc` (ships under the **`rc`** dist-tag; `latest` untouched, consumers opt in
    with `@rc`). Equivalent: `npm publish --tag rc`.
  - `release` / `patch` / `minor` / `major` → `make publish` (ships **`latest`**). Equivalent:
    `npm publish`.
  - Both Makefile targets prompt for confirmation, then run `verify` → `clean:dist` → `build` →
    `npm publish`, so the user just runs the one command after `npm login`.
- A reminder: the CHANGELOG is now finalized for `NEW_VERSION`. If the publish fails, revert the version
  bump (`package.json`) and the CHANGELOG finalize before retrying — the registry refuses a re-publish of
  the same version.

## Things not to do

- **Do not run `npm publish`** — the user publishes manually (via the Makefile targets) after `npm login`.
- **Do not push to the git remote.** The commit stays local until the user pushes.
- **Do not skip the verify gate or the build** — a stale/broken `dist/` would ship outdated or broken
  artifacts to every dependent component.
- **Do not invent CHANGELOG entries** to cover commits you find; ask the user if something's missing.
- **Do not bump if `## [Unreleased]` has nothing meaningful** — stop and explain.
- **Do not stage `dist/`** or any private file.
