---
name: prepare-release
description: Prepare a Cherry Studio Pi release by collecting commits, generating bilingual release notes, and preparing the version commit/tag. Use when asked to prepare/create a release, bump version, or run `/prepare-release`.
---

# Prepare Release

Prepare the Cherry Studio Pi release workflow: collect changes -> generate bilingual release notes -> update files -> create exactly one version commit and annotated tag -> publish exactly once through the manual GitHub Actions Release workflow.

Cherry Studio Pi release publishing is intentionally manual-only. An ordinary bug-fix commit/push must not publish installers, push release tags, or dispatch the Release workflow. If the user asks to fix a bug after a release, fix it and push code only; do not publish another release unless the user explicitly asks for another release in a new message.

## Arguments

Parse the version intent from the user's message. Accept any of these forms:
- Bump type keyword: `patch`, `minor`, `major`
- Natural language: "prepare a beta release", "bump to 1.8.0-rc.2", etc.

Defaults to `patch` if no version is specified. The guarded local helper currently accepts `patch`, `minor`, or `major`; exact versions require an explicit manual version-edit plan before any file changes. Always echo the resolved target version back to the user before proceeding with any file edits.

- `--dry-run`: Preview only, do not create a version commit, tag, or workflow dispatch.

## Workflow

### Step 1: Determine Version

1. Get the latest tag:
   ```bash
   git describe --tags --abbrev=0
   ```
2. Read current version from `package.json`.
3. Compute the new version based on the argument:
   - `patch` / `minor` / `major`: bump from the current tag version.
   - Exact versions are not handled by `pnpm release`; stop and ask for confirmation before any manual exact-version edit.

### Step 2: Collect Commits

1. List all commits since the last tag:
   ```bash
   git log <last-tag>..HEAD --format="%H %s" --no-merges
   ```
2. For each commit, get the full body:
   ```bash
   git log <hash> -1 --format="%B"
   ```
3. Extract the content inside `` ```release-note `` code blocks from each commit body.
4. Extract the conventional commit type from the title (`feat`, `fix`, `refactor`, `perf`, `docs`, etc.).
5. **Skip** these commits:
   - Titles starting with `🤖 Daily Auto I18N`
   - Titles starting with `Merge`
   - Titles starting with `chore(deps)`
   - Titles starting with `chore: release`
   - Commits where the release-note block says `NONE`

### Step 3: Generate Bilingual Release Notes

Using the collected commit information, generate release notes in **both English and Chinese**.

**Format** (must match exactly):

```
<!--LANG:en-->
Cherry Studio Pi {version} - {Brief English Title}

✨ New Features
- [Component] Description

🐛 Bug Fixes
- [Component] Description

💄 Improvements
- [Component] Description

⚡ Performance
- [Component] Description

<!--LANG:zh-CN-->
Cherry Studio Pi {version} - {简短中文标题}

✨ 新功能
- [组件] 描述

🐛 问题修复
- [组件] 描述

💄 改进
- [组件] 描述

⚡ 性能优化
- [组件] 描述
<!--LANG:END-->
```

**Rules:**
- Only include categories that have entries (omit empty categories).
- Each commit appears as exactly ONE line item in the appropriate category.
- Use the `release-note` field if present; otherwise summarize from the commit title.
- Component tags should be short: `[Chat]`, `[Models]`, `[Agent]`, `[MCP]`, `[Settings]`, `[Data]`, `[Build]`, etc.
- Chinese translations should be natural, not machine-literal.
- Do NOT include commit hashes or PR numbers.
- Read the **existing** release notes in `electron-builder.yml` as a style reference before writing.

**IMPORTANT: User-Focused Content Only**

Release notes are for **end users**, not developers. Exclude anything users don't care about:

- **EXCLUDE** internal refactoring, code cleanup, or architecture changes
- **EXCLUDE** CI/CD, build tooling, or test infrastructure changes
- **EXCLUDE** dependency updates (unless they add user-visible features)
- **EXCLUDE** documentation updates
- **EXCLUDE** developer experience improvements
- **EXCLUDE** technical debt fixes with no user-visible impact
- **EXCLUDE** overly technical descriptions (e.g., "fix race condition in Redux middleware")

**INCLUDE** only changes that users will notice:
- New features they can use
- Bug fixes that affected their workflow
- UI/UX improvements they can see
- Performance improvements they can feel
- Security fixes (simplified, without implementation details)

**Keep descriptions simple and non-technical:**
- ❌ "Fix streaming race condition causing partial tool response status in Redux state"
- ✅ "Fix tool status not stopping when aborting"
- ❌ "Auto-convert reasoning_effort to reasoningEffort for OpenAI-compatible providers"
- ✅ "Fix deep thinking mode not working with some providers"

### Step 4: Update Files

1. **`package.json`**: Update the `"version"` field to the new version.
2. **`electron-builder.yml`**: Replace the content under `releaseInfo.releaseNotes: |` with the generated notes. Preserve the 4-space YAML indentation for the block scalar content.

### Step 5: Present for Review

Show the user:
- The new version number.
- The full generated release notes.
- A summary of which files were modified.

If `--dry-run` was specified, stop here.

Otherwise, ask the user to confirm before proceeding to Step 6.

### Step 6: Create Version Commit and Annotated Tag

1. Make sure the worktree is clean and the remote is `CherryHQ/cherry-studio-pi`.
2. Create the version commit and annotated tag through the guarded helper:
   ```bash
   CHERRY_STUDIO_PI_RELEASE_CONFIRM=v{version} pnpm release {patch|minor|major}
   ```
   Use the exact target tag in `CHERRY_STUDIO_PI_RELEASE_CONFIRM`. Do not reuse an old confirmation value.
3. Push the version commit first, then push that exact tag only after checking the user really asked to make this tag available for the one manual release. Pushing the tag does not publish installers; it only makes the tag selectable by the manual Release workflow. Do not chain these commands in one shell line:
   ```bash
   git push
   git push origin v{version}
   ```
4. Publishing installers is a separate explicit action: run **Actions -> Release -> Run workflow** with `tag=v{version}` and `confirm_tag=v{version}`. Run it once for the user's release request.

## CI Trigger Chain

- Pushing normal commits runs **`ci.yml`** only.
- Pushing a tag does not publish installers.
- **`release.yml`** is manual-only (`workflow_dispatch`) and requires matching `tag` and `confirm_tag`.
- The Release workflow builds macOS, Windows, and Linux installers, then creates or updates one GitHub Release for the requested tag.

## Constraints

- Always read `electron-builder.yml` before modifying it to understand the current format.
- Never modify files other than `package.json` and `electron-builder.yml`.
- Never publish a second release for the same user request. If a follow-up fix is needed, make a normal commit/push and wait for a separate explicit release request.
- Always show the generated release notes to the user before creating the version commit/tag (unless running in CI with no interactive user).
