# Tasks: Scheduled Research Workflow

**Input**: Design documents from `/specs/20260408-190912-scheduled-research-workflow/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: No automated tests — validation is manual via `workflow_dispatch` trigger.

**Organization**: Tasks are grouped by user story. Since this feature is a single workflow YAML file built incrementally, each phase adds capabilities to `.github/workflows/research.yml`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Workflow file**: `.github/workflows/research.yml`
- **Spec/plan docs**: `specs/20260408-190912-scheduled-research-workflow/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the workflow skeleton with triggers, permissions, authentication, and concurrency controls — the foundation all user stories build on.

- [x] T001 Create workflow file `.github/workflows/research.yml` with `name: Scheduled Research`, triggers (`schedule` with cron `0 */12 * * *` and `workflow_dispatch`), permissions (`contents: read`, `issues: write`, `id-token: write`), and concurrency group (`research-workflow` with `cancel-in-progress: false`)
- [x] T002 Add the job definition with `runs-on: ubuntu-latest`, `timeout-minutes: 15`, checkout step using `actions/checkout@v6` with `fetch-depth: 0`, and the `anthropics/claude-code-action@v1` step with `anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}`, `github_token: ${{ secrets.PERSONAL_ACCESS_TOKEN }}`, `allowed_bots: '*'`, and `track_progress: true`
- [x] T003 Add a secret validation step before the Claude Code Action step in `.github/workflows/research.yml`: use `if: ${{ secrets.ANTHROPIC_API_KEY != '' && secrets.PERSONAL_ACCESS_TOKEN != '' }}` on the job, and add a preceding job or step that fails with a clear error message (`echo "::error::Missing required secrets: ANTHROPIC_API_KEY and/or PERSONAL_ACCESS_TOKEN" && exit 1`) when secrets are absent
- [x] T004 Configure `claude_args` with `--max-turns 20`, `--allowedTools "WebSearch,WebFetch,Read,Glob,Grep,Bash(gh issue create:*),Bash(gh issue list:*),Bash(gh label create:*),Bash(git log:*)"`, and `--disallowedTools ""`

**Checkpoint**: Workflow file exists with valid syntax, correct triggers, auth workarounds (PAT, allowed_bots), and tool allowlist. Can be triggered via `workflow_dispatch` (prompt will be added in US1).

---

## Phase 2: User Story 1 - Automated Agent Improvement Research (Priority: P1) — MVP

**Goal**: The workflow runs on schedule or via manual trigger, performs deep hybrid research (codebase + web search), checks for duplicate issues, and creates exactly one deeply researched GitHub issue per run.

**Independent Test**: Trigger via `workflow_dispatch` in GitHub Actions UI. Verify it creates one well-structured issue with deep analysis and Mermaid diagram, or completes with a summary log if no finding.

### Implementation for User Story 1

- [x] T005 [US1] Write the research prompt in the `prompt` input of the Claude Code Action step in `.github/workflows/research.yml`. The prompt MUST instruct Claude Code to: (0) Mission — improve the agent toward full autonomy; every finding must move the platform closer to independent operation; (1) Analyze the codebase for bugs, performance issues, security concerns, and architecture improvements; (2) Use WebSearch to research current AI agent best practices, new libraries, and ecosystem updates; (3) Use `gh issue list --label research --state open` to check existing open issues and skip duplicate findings; (4) Identify the single highest-impact finding and create exactly ONE GitHub issue using `gh issue create` with title format `research: [area] - [summary]` and the `research` label — the issue must be deeply researched with thorough analysis; (5) Quality gate — every finding MUST be feasible (implementable in the current codebase and tech stack), extendable (composable with existing architecture, not requiring rewrites), and 100% accurate (all file paths, function names, line numbers, and external URLs must be verified as real). If a finding fails any criterion, do not suggest it; (6) If no actionable finding meeting the quality gate is identified, output a summary of what was evaluated and why no issue was created
- [x] T006 [US1] Ensure the `research` label exists by adding a prompt instruction to run `gh label create research --description "Automated research finding" --color 0e8a16 --force` at the start (the `--force` flag is idempotent — creates only if missing)
- [x] T007 [US1] Add the issue body template to the prompt instructions per the contract in `specs/20260408-190912-scheduled-research-workflow/contracts/workflow-contract.md`: each issue body MUST include sections for Finding, Diagram (Mermaid), Rationale, References (Internal + External), Suggested Next Steps, and a footer with the generation date. The Mermaid diagram MUST visually explain the finding using GitHub-compatible syntax (classDef with high-contrast hex colors, `<br/>` for newlines, no parentheses in node labels, `:::className` inline syntax, no multiple subgraph blocks, 3+ char node IDs)

**Checkpoint**: Trigger via `workflow_dispatch`. Claude Code should analyze the codebase, perform web searches, and create one research issue. Verify: issue appears with `research` label, title format matches `research: [area] - [summary]`, body has all required sections (Finding, Diagram, Rationale, References, Next Steps), analysis is thorough, no duplicate of existing open issues.

---

## Phase 3: User Story 2 - Manual Trigger with Custom Focus (Priority: P2)

**Goal**: `workflow_dispatch` accepts an optional `focus_area` input that scopes research to a specific area.

**Independent Test**: Trigger via `workflow_dispatch` with `focus_area` set to "memory system". Verify all created issues are scoped to memory-related findings. Then trigger without `focus_area` and verify general research.

### Implementation for User Story 2

- [x] T008 [US2] Add the `focus_area` input to the `workflow_dispatch` trigger in `.github/workflows/research.yml` with `description: "Area to focus research on (e.g., 'memory system', 'security', 'performance')"`, `required: false`, `type: string`, `default: ""`
- [x] T009 [US2] Update the research prompt to conditionally scope research: if `${{ github.event.inputs.focus_area }}` is non-empty, instruct Claude Code to focus research exclusively on that area; if empty or on scheduled trigger, perform general-purpose research across the entire platform
- [x] T010 [US2] Add the focus area to the issue title convention when provided: `research: [focus_area] - [summary]` (e.g., `research: memory system - pgvector HNSW index tuning`)

**Checkpoint**: Trigger with `focus_area: "security"`. All created issues should be security-related. Trigger without focus area — should produce general findings.

---

## Phase 4: User Story 3 - Research History and Tracking (Priority: P3)

**Goal**: Issues have consistent formatting, area-specific labels, and are identifiable for long-term tracking and filtering.

**Independent Test**: Run the workflow multiple times. Verify: each issue follows the template exactly, area labels are applied (e.g., `memory`, `security`, `performance`), and issues are filterable by label in the GitHub Issues UI.

### Implementation for User Story 3

- [x] T011 [US3] Update the prompt to instruct Claude Code to apply area-specific labels in addition to `research`: use `gh label create [area] --force` and `--label research,[area]` on `gh issue create` — areas include `memory`, `security`, `performance`, `agent-engine`, `tools`, `infrastructure`
- [x] T012 [US3] Update the prompt to include the generation date in the issue footer: `*Generated by scheduled research workflow on YYYY-MM-DD*` and add a section `## Areas Evaluated` listing what was analyzed but not flagged, to support tracking of research coverage over time

**Checkpoint**: Run workflow twice. Verify: issues have both `research` and area labels, footer includes date, body includes areas evaluated section. Filter by `label:research` in GitHub Issues — all research issues should appear.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, documentation, and cleanup.

- [x] T013 Validate the complete workflow YAML syntax by running `act -n -W .github/workflows/research.yml` (dry-run) or manually reviewing against GitHub Actions schema in `.github/workflows/research.yml`
- [x] T014 Add inline YAML comments to `.github/workflows/research.yml` explaining: the PAT workaround for cron OIDC issue (#814), the `allowed_bots` workaround (#900), the `--disallowedTools ""` workaround for WebSearch (#690), the `--max-turns 20` cost control rationale, and the one-issue-per-run design decision
- [x] T015 Run the quickstart validation from `specs/20260408-190912-scheduled-research-workflow/quickstart.md`: verify secrets are configured, trigger via `workflow_dispatch`, confirm issues are created with correct format

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **User Story 1 (Phase 2)**: Depends on Setup (T001-T004) completion
- **User Story 2 (Phase 3)**: Depends on US1 (T005-T007) — adds focus_area input to existing prompt
- **User Story 3 (Phase 4)**: Depends on US1 (T005-T007) — adds labeling and tracking to existing prompt
- **Polish (Phase 5)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Setup — MVP, no dependencies on other stories
- **User Story 2 (P2)**: Depends on US1 (extends the prompt with focus_area scoping)
- **User Story 3 (P3)**: Depends on US1 (extends the prompt with labeling and tracking)
- **US2 and US3**: Independent of each other — can be implemented in parallel after US1

### Within Each User Story

- All tasks within a story are sequential (same file: `.github/workflows/research.yml`)
- No parallel opportunities within a story since everything modifies one file

### Parallel Opportunities

- US2 and US3 are independent and could be parallelized (if working on separate branches)
- In practice, since all changes are to a single YAML file, sequential execution is recommended
- T013 and T014 in Polish phase can run in parallel (validation vs. comments)

---

## Parallel Example: User Stories 2 & 3

```text
# After US1 is complete, these two stories are independent:
# (In practice, merge US2 first, then US3, since both modify the same file)

Branch A (US2): Add focus_area input and prompt scoping
Branch B (US3): Add area labels and tracking sections
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004) — workflow skeleton
2. Complete Phase 2: US1 (T005-T007) — research prompt + issue creation
3. **STOP and VALIDATE**: Trigger via `workflow_dispatch`, verify issues are created
4. Merge to main — scheduled research is now active every 12 hours

### Incremental Delivery

1. Setup + US1 → Test via `workflow_dispatch` → Merge (MVP!)
2. Add US2 → Test with focus_area → Merge (directed research)
3. Add US3 → Test labeling → Merge (tracking & history)
4. Polish → Validate complete workflow → Done

### Single Developer Strategy

Since all changes are to one file, work sequentially:
1. T001 → T002 → T003 → T004 (setup)
2. T005 → T006 → T007 (core research)
3. T008 → T009 → T010 (focus area)
4. T011 → T012 (tracking)
5. T013 → T014 → T015 (polish)

---

## Notes

- All tasks modify a single file: `.github/workflows/research.yml`
- No TypeScript code, no database changes, no package additions
- Validation is manual via `workflow_dispatch` — no automated test tasks
- Commit after each phase checkpoint for clean git history
- The research prompt is the most complex part (T005) — take time to get it right
- Cost: ~20 turns per run × 2 runs/day = ~40 turns/day of Claude API usage
- One issue per run enables deep analysis with proper Mermaid diagrams and thorough references
