# Feature Specification: Scheduled Research Workflow

**Feature Branch**: `20260408-190912-scheduled-research-workflow`
**Created**: 2026-04-08
**Status**: Draft
**Input**: User description: "Use claude code action to run scheduled GitHub Actions workflow to research features how to improve the autonomous agent and apply to this repository"

## Mission

The goal of this research workflow is to **improve PersonalClaw toward full autonomy**. Every finding must move the agent closer to operating independently without human intervention. Findings must be:

- **Feasible**: Implementable within the current codebase and tech stack. No theoretical suggestions or ideas requiring technology that doesn't exist.
- **Extendable**: Build on existing architecture rather than requiring rewrites. Each improvement should compose with previous improvements.
- **100% Accurate**: Every claim must be verifiable. File paths, function names, and line numbers must be real. External references must link to actual documentation. No hallucinated libraries or APIs.

## Clarifications

### Session 2026-04-08

- Q: What research scope strategy should the workflow use? → A: Hybrid — internal codebase analysis combined with web search for best practices, new patterns, and ecosystem updates.
- Q: Should `workflow_dispatch` be a first-class testing mechanism? → A: Yes — `workflow_dispatch` must be the primary way to test and validate the workflow before relying on cron scheduling.
- Q: What should the workflow produce as output? → A: GitHub issues only. All research findings become issues for manual triage — no automated code changes or PRs.
- Q: How many issues per run and how should findings be grouped? → A: Exactly one issue per run. The workflow must focus deeply on a single finding with thorough analysis, Mermaid diagram, and comprehensive references.
- Q: What schedule frequency? → A: Every 12 hours (cron: `0 */12 * * *`).
- Q: Should the workflow check for existing issues before creating new ones? → A: Yes — the workflow MUST check existing open issues and skip creating a new issue if an equivalent finding already exists. Duplicate avoidance is mandatory.

### Research Findings (Claude Code Action)

The following constraints were discovered by researching the Claude Code Action GitHub repository, official docs, and community usage:

1. **WebSearch/WebFetch disabled by default** ([#690](https://github.com/anthropics/claude-code-action/issues/690)): The action hardcodes these tools as disabled. Fix merged (PR #1033). Must explicitly use `--allowedTools "WebSearch,WebFetch,..."` and `--disallowedTools ""` to enable web search.
2. **Cron triggers fail OIDC auth** ([#814](https://github.com/anthropics/claude-code-action/issues/814)): Scheduled (cron) workflows fail with 401 during OIDC token exchange. **Workaround**: Use a PAT or GitHub App token (`actions/create-github-app-token`) instead of built-in OIDC.
3. **Bot actor check blocks cron** ([#900](https://github.com/anthropics/claude-code-action/issues/900)): Fixed in PR #916. Must use `allowed_bots: '*'` for scheduled workflows.
4. **Best practices from official docs**: Use `--max-turns` for cost control, `CLAUDE.md` for consistent behavior, `fetch-depth: 0` for full repo history, `track_progress: true` for visibility, concurrency controls to prevent overlapping runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automated Agent Improvement Research (Priority: P1)

As a project maintainer, I want a scheduled GitHub Actions workflow that periodically uses Claude Code to research potential improvements for the autonomous agent platform — both by analyzing the internal codebase and by searching the web for current best practices, new AI agent patterns, and ecosystem updates — so that the project continuously evolves with new ideas without requiring manual research effort.

**Why this priority**: This is the core value proposition — automating the discovery of improvements. Without this, no research happens and the remaining stories have no purpose. The hybrid approach (internal analysis + web search) ensures proposals are grounded in the actual codebase while informed by the latest external knowledge.

**Independent Test**: Can be fully tested by triggering the workflow via `workflow_dispatch` and verifying it creates a GitHub issue containing a deeply researched improvement finding with supporting reasoning, Mermaid diagram, and references from both internal code analysis and external sources.

**Acceptance Scenarios**:

1. **Given** the workflow is configured with a cron schedule, **When** the scheduled time arrives, **Then** the workflow triggers automatically and Claude Code begins researching improvements for the agent platform using both codebase analysis and web search.
2. **Given** the workflow is triggered via `workflow_dispatch` for testing, **When** Claude Code completes its research and identifies a finding, **Then** exactly one GitHub issue is created containing a deeply researched finding with rationale, Mermaid diagram, references (internal code locations and external sources), and suggested next steps for the maintainer to triage.
3. **Given** the workflow runs, **When** Claude Code identifies no actionable improvements in a given run, **Then** the workflow completes successfully without creating any issues and logs a summary of what was evaluated (areas analyzed, web searches performed, and why no findings were warranted).

---

### User Story 2 - Manual Trigger for Testing and Directed Research (Priority: P2)

As a project maintainer, I want to manually trigger the research workflow via `workflow_dispatch` — both to test the workflow itself and to direct research toward a specific area of focus (e.g., "memory system", "tool integration", "security hardening") — so that I can validate the workflow works correctly and steer research toward areas that need attention.

**Why this priority**: `workflow_dispatch` is the primary way to test and validate the workflow before trusting it on a cron schedule. It also enables human-guided steering of research focus. This must work reliably before the cron schedule is meaningful.

**Independent Test**: Can be fully tested by triggering the workflow via `workflow_dispatch` with and without a custom focus area input, verifying the workflow runs end-to-end and produces the expected output.

**Acceptance Scenarios**:

1. **Given** the workflow supports a `workflow_dispatch` trigger with an optional "focus area" input, **When** the maintainer triggers it with focus area "memory system improvements", **Then** Claude Code scopes its research to the memory subsystem and creates one deeply targeted issue for that area.
2. **Given** the maintainer triggers the workflow via `workflow_dispatch` without specifying a focus area, **When** Claude Code runs, **Then** it performs general-purpose hybrid research (codebase analysis + web search) across the entire agent platform and creates one issue for the highest-impact finding.
3. **Given** the maintainer wants to validate the workflow setup, **When** they trigger it via `workflow_dispatch` from the GitHub Actions UI, **Then** the workflow runs identically to a cron-triggered run and produces visible output (issues or completion log) confirming correct operation.

---

### User Story 3 - Research History and Tracking (Priority: P3)

As a project maintainer, I want each research run to produce well-structured GitHub issues with consistent formatting and labeling, so that I can review the research history over time, track which areas have been investigated, and triage findings efficiently.

**Why this priority**: Enables long-term tracking and prevents duplicate research. Lower priority because the system delivers value even without structured tracking.

**Independent Test**: Can be fully tested by running the workflow multiple times and verifying each issue follows a consistent structure with a title convention, research summary, rationale, and links to relevant documentation or references.

**Acceptance Scenarios**:

1. **Given** a research run completes with findings, **When** GitHub issues are created, **Then** each issue follows a consistent template including: research summary, rationale, references consulted (internal code + external sources), and suggested next steps.
2. **Given** multiple research runs have completed, **When** reviewing the issue history, **Then** each issue is identifiable by a consistent title convention (`research: [area] - [summary]`) and labeled appropriately for filtering and triage.

---

### Edge Cases

- What happens when the workflow runs but the GitHub Actions runner has no access to required secrets (e.g., Anthropic API key, PAT)?
- How should the workflow match "equivalent" findings against existing issues — by title similarity, label matching, or semantic comparison of issue body content?
- What happens if two scheduled runs overlap (e.g., a long-running research session hasn't completed before the next cron trigger)?
- What happens if the workflow consistently finds no actionable improvements across multiple consecutive runs?
- How does the workflow handle rate limiting from the LLM provider during research?
- What happens if the PAT expires or is revoked — how does the workflow signal this to the maintainer?
- What happens if the WebSearch fix (PR #1033) is not yet deployed to the action version in use — does the workflow degrade gracefully to internal-only research?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST include a GitHub Actions workflow file that runs on a configurable cron schedule.
- **FR-002**: The workflow MUST use the official Claude Code GitHub Action to perform research, with web search explicitly enabled (WebSearch and WebFetch are disabled by default in the action — must use `--allowedTools` and `--disallowedTools ""` to override) to discover current best practices, new libraries, and AI agent ecosystem updates.
- **FR-003**: The workflow MUST support manual triggering via `workflow_dispatch` with an optional "focus area" text input. `workflow_dispatch` is the primary mechanism for testing and validating the workflow.
- **FR-004**: The workflow MUST create exactly one GitHub issue per run, focusing deeply on a single finding. The issue MUST contain a thorough analysis with rationale, references, suggested next steps, and a Mermaid diagram that visually explains the finding (e.g., data flow, architecture impact, before/after comparison, or affected component relationships). If no actionable finding is identified, no issue is created.
- **FR-005**: The workflow MUST skip issue creation when no findings are identified, and instead log a summary of what was evaluated.
- **FR-006**: The workflow MUST use concurrency controls to prevent overlapping runs from the same schedule.
- **FR-007**: The workflow MUST check all existing open issues before creating new ones. If an equivalent finding already has an open issue, the workflow MUST skip that finding entirely rather than creating a duplicate.
- **FR-008**: Issues created by the workflow MUST follow a consistent title convention and be labeled for easy identification, filtering, and triage.
- **FR-009**: The workflow MUST provide Claude Code with sufficient context about the repository's architecture, conventions, and current state to produce relevant proposals.
- **FR-010**: The workflow MUST use repository secrets for any required API keys, and fail gracefully with a clear error message if secrets are missing.
- **FR-011**: The workflow MUST use a Personal Access Token (PAT) or GitHub App token for authentication instead of the built-in OIDC, because cron-triggered workflows fail OIDC token exchange (see [#814](https://github.com/anthropics/claude-code-action/issues/814)).
- **FR-012**: The workflow MUST set `allowed_bots: '*'` to bypass the bot actor check that blocks scheduled workflows (see [#900](https://github.com/anthropics/claude-code-action/issues/900)).
- **FR-013**: The workflow MUST use `--max-turns` to control cost per run, and `track_progress: true` for visibility into long-running research sessions.
- **FR-014**: The workflow MUST checkout the repository with `fetch-depth: 0` (full history) to give Claude Code complete codebase context for analysis.
- **FR-015**: The research prompt MUST instruct Claude Code that its mission is to improve the agent toward full autonomy. Every finding MUST be feasible (implementable in the current codebase), extendable (composable with existing architecture), and 100% accurate (all file paths, function names, and external references must be verified). If a finding cannot meet all three criteria, it MUST NOT be suggested.

### Key Entities

- **Research Workflow**: The scheduled automation definition that orchestrates the periodic research process.
- **Research Prompt**: The instruction set provided to Claude Code that guides what to research and how to apply findings — scoped by optional focus area.
- **Research Issue**: The output artifact — a GitHub issue containing research findings, rationale, references, and suggested next steps for manual triage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The workflow runs successfully on its configured schedule without manual intervention at least 95% of the time (excluding infrastructure outages).
- **SC-002**: Each research-generated issue includes a structured description that a reviewer can understand the finding and rationale within 5 minutes of reading.
- **SC-003**: At least 50% of research-generated issues contain actionable findings that the maintainer considers worth investigating or acting on.
- **SC-004**: The workflow completes a research cycle (from trigger to issue creation or completion without issues) within 15 minutes.
- **SC-005**: Manual triggers with a focus area produce findings scoped to that area at least 80% of the time.

## Assumptions

- The Claude Code GitHub Action (v1) is available in the GitHub Actions marketplace with the WebSearch fix (PR #1033) deployed, enabling web search via `--allowedTools`.
- The maintainer has access to an Anthropic API key and a Personal Access Token (PAT) or GitHub App credentials, both stored as GitHub Actions secrets.
- The cron schedule will run every 12 hours (`0 */12 * * *`) but can be adjusted by editing the workflow file.
- Claude Code has sufficient capability to understand the codebase, perform web research, and produce well-structured research findings when given appropriate context and prompts.
- The research workflow will use a PAT or GitHub App token (not OIDC) for authentication due to the known cron OIDC failure ([#814](https://github.com/anthropics/claude-code-action/issues/814)).
- Rate limiting from LLM providers is handled by Claude Code internally and does not require workflow-level retry logic.
- The workflow produces GitHub issues only — no automated code changes, branches, or pull requests. All code changes are performed manually by the maintainer after triaging issues.
- The `CLAUDE.md` file in the repository root will be respected by the action, providing consistent research context and project conventions.
