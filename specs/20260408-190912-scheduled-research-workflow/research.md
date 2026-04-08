# Research: Scheduled Research Workflow

**Date**: 2026-04-08 | **Branch**: `20260408-190912-scheduled-research-workflow`

## Decision 1: Authentication Method for Cron Triggers

**Decision**: Use a Personal Access Token (PAT) stored as `PERSONAL_ACCESS_TOKEN` GitHub Secret, passed via `github_token` input.

**Rationale**: The Claude Code Action's built-in OIDC authentication fails with 401 on cron-triggered workflows ([#814](https://github.com/anthropics/claude-code-action/issues/814)). This is an open, unresolved issue. The PAT workaround is recommended in the [official FAQ](https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md). A GitHub App token via `actions/create-github-app-token` is also viable but adds setup complexity.

**Alternatives considered**:
- OIDC (built-in): Rejected — fails on cron triggers with 401 Unauthorized
- GitHub App token: Viable but requires App creation, private key management, and `actions/create-github-app-token` step — more complex than PAT for a single-repo use case
- `GITHUB_TOKEN`: Insufficient — cannot trigger subsequent workflows and has limited permissions for issue creation in some configurations

## Decision 2: Enabling WebSearch in the Action

**Decision**: Use `--allowedTools` with explicit WebSearch/WebFetch inclusion and `--disallowedTools ""` override in `claude_args`.

**Rationale**: WebSearch and WebFetch are hardcoded as disabled by default in the Claude Code Action ([#690](https://github.com/anthropics/claude-code-action/issues/690)). The fix (PR #1033) requires explicitly listing them in `--allowedTools` and setting `--disallowedTools ""` to clear the default blocklist.

**Alternatives considered**:
- Relying on default tool configuration: Rejected — WebSearch/WebFetch would be disabled
- Using only `--allowedTools` without `--disallowedTools ""`: Rejected — the default disallowed list takes precedence over allowedTools in older versions

## Decision 3: Bot Actor Check Bypass

**Decision**: Set `allowed_bots: '*'` on the Claude Code Action step.

**Rationale**: The `checkHumanActor` function blocks scheduled workflows by default ([#900](https://github.com/anthropics/claude-code-action/issues/900)). Fixed in PR #916 — the wildcard `*` bypasses all bot actor checks. This is the official recommended approach for scheduled workflows.

**Alternatives considered**:
- Specific bot name in `allowed_bots`: Rejected — the exact bot name for cron triggers varies and is fragile
- Forking the action: Rejected — unnecessary when wildcard works

## Decision 4: Research Prompt Strategy

**Decision**: Embed the research prompt inline in the workflow YAML using the `prompt` input. The prompt instructs Claude Code to:
1. Mission: Improve the agent toward full autonomy — every finding must move the platform closer to independent operation
2. Analyze the codebase for bugs, performance issues, security concerns, and architecture improvements
3. Search the web for current AI agent best practices, new libraries, and ecosystem updates
4. Check existing open and closed issues to avoid duplicates
5. Create exactly one GitHub issue per run with deep analysis, each with: title convention `research: [area] - [summary]`, structured body (finding, Mermaid diagram, rationale, references, next steps), and `research` label
6. Quality gate: Every finding must be feasible (implementable now), extendable (composable with existing architecture), and 100% accurate (all references verified). If a finding fails any criterion, do not suggest it.
7. If a focus area is provided via `workflow_dispatch`, scope research to that area

**Rationale**: Inline prompt is the standard pattern per [Claude Code Action docs](https://code.claude.com/docs/en/github-actions). The `CLAUDE.md` file in the repo root provides additional persistent context automatically.

**Alternatives considered**:
- External prompt file: Rejected — adds file management complexity for no benefit; inline is the documented pattern
- Multiple workflow steps: Rejected — single Claude Code invocation with comprehensive prompt is simpler and cheaper than chaining

## Decision 5: Cost Control

**Decision**: Set `--max-turns 20` to allow sufficient research depth for one deep finding while capping cost. Use `track_progress: true` for visibility.

**Rationale**: With exactly 1 issue per run, 20 turns is sufficient for: codebase analysis (~5 turns), web search (~3-5 turns), duplicate checking (~1 turn), Mermaid diagram creation (~2 turns), and issue creation (~1 turn). The [official docs](https://code.claude.com/docs/en/github-actions) recommend `--max-turns` for cost control.

**Alternatives considered**:
- Default (10 turns): Rejected — too few for deep research + web search + diagram creation
- 30+ turns: Rejected — excessive for a single-issue workflow running every 12 hours
- No cap: Rejected — unacceptable cost risk for automated runs

## Decision 6: Concurrency Control

**Decision**: Use GitHub Actions `concurrency` with `group: research-workflow` and `cancel-in-progress: false`.

**Rationale**: With 12-hour intervals, overlap is unlikely but possible if a run takes longer than expected. `cancel-in-progress: false` ensures a long-running research session completes rather than being killed by the next scheduled trigger. The queued run will start after the current one finishes.

**Alternatives considered**:
- `cancel-in-progress: true`: Rejected — would kill a productive long-running research session
- No concurrency control: Rejected — risk of parallel runs creating duplicate issues

## Decision 7: Issue Duplicate Detection

**Decision**: Instruct Claude Code in the prompt to use `gh issue list --state all` to search existing open AND closed issues before creating new ones. Match by title prefix and label.

**Rationale**: Claude Code has access to `gh` CLI within the action. Searching by title prefix (`research:`) and comparing findings before creating is the simplest approach. Checking closed issues prevents re-raising already-addressed findings. Semantic comparison of issue bodies would require embedding infrastructure not available in a GitHub Actions runner.

**Alternatives considered**:
- Semantic comparison of issue bodies: Rejected — requires embedding model not available in the action
- External deduplication script: Rejected — adds complexity; Claude Code can handle this in-prompt
- GitHub issue search API via REST: Viable but `gh issue list` is simpler and already available

## Decision 8: Tool Allowlist

**Decision**: Allow the following tools via `--allowedTools`:
- `WebSearch` — web research for best practices and ecosystem updates
- `WebFetch` — fetch specific documentation pages
- `Read` — read repository files for analysis
- `Glob` — find files by pattern
- `Grep` — search code content
- `Bash(gh issue create:*)` — create GitHub issues
- `Bash(gh issue list:*)` — list existing issues for deduplication
- `Bash(gh label create:*)` — create labels if needed
- `Bash(git log:*)` — analyze recent changes and commit history

**Rationale**: Minimal tool set for research + issue creation. No `Write`, `Edit`, or `Bash(git push:*)` since the workflow produces issues only, not code changes. This follows the principle of least privilege recommended in the [solutions.md](https://github.com/anthropics/claude-code-action/blob/main/docs/solutions.md).

**Alternatives considered**:
- Full tool access: Rejected — unnecessary and risky for an automated scheduled job
- Adding `Write`/`Edit`: Rejected — spec explicitly states issues only, no code changes
