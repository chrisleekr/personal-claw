# Implementation Plan: Scheduled Research Workflow

**Branch**: `20260408-190912-scheduled-research-workflow` | **Date**: 2026-04-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260408-190912-scheduled-research-workflow/spec.md`

## Summary

Add a scheduled GitHub Actions workflow that uses the Claude Code Action to research improvements for the PersonalClaw autonomous agent platform. The workflow runs every 12 hours (and on-demand via `workflow_dispatch`), performs deep hybrid research (codebase analysis + web search), and creates exactly one deeply researched GitHub issue per run. No automated code changes — the single finding is an issue for manual triage. Must work around known Claude Code Action limitations: OIDC failure on cron (#814), WebSearch disabled by default (#690), and bot actor check (#900).

## Technical Context

**Language/Version**: YAML (GitHub Actions workflow syntax) — no TypeScript code changes
**Primary Dependencies**: `anthropics/claude-code-action@v1`, `actions/checkout@v6`
**Storage**: N/A — no database changes
**Testing**: Manual validation via `workflow_dispatch` trigger; no automated tests for workflow files
**Target Platform**: GitHub Actions (ubuntu-latest runner)
**Project Type**: CI/CD workflow addition
**Performance Goals**: Complete research cycle within 15 minutes per run
**Constraints**: Exactly 1 issue per run (deep focus), PAT required (not OIDC), WebSearch must be explicitly enabled, each issue must include a Mermaid diagram
**Scale/Scope**: Single workflow file + research prompt; no application code changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicable? | Status | Notes |
| --------- | ----------- | ------ | ----- |
| I. Strict TypeScript and Bun Runtime | No | N/A | No TypeScript code added — workflow YAML only |
| II. Package Boundary Isolation | No | N/A | No package imports — workflow YAML only |
| III. Channel Isolation | No | N/A | No database queries |
| IV. Documentation Standards | Yes | PASS | Workflow file is self-documenting via comments; no exported symbols |
| V. Memory Engine Encapsulation | No | N/A | No memory operations |
| VI. Security by Default | Yes | PASS | All secrets via GitHub Secrets (`ANTHROPIC_API_KEY`, PAT); no hardcoded credentials |
| VII. Structured Observability | No | N/A | No backend code; GitHub Actions provides built-in logging |
| Commit Messages | Yes | PASS | Will use `ci:` prefix for workflow addition |
| Branch Strategy | Yes | PASS | Using timestamp branch: `20260408-190912-scheduled-research-workflow` |

**Pre-Phase 0 gate**: PASS — no violations.
**Post-Phase 1 re-check**: PASS — design adds only YAML workflow + GitHub issues. No new violations.

## Project Structure

### Documentation (this feature)

```text
specs/20260408-190912-scheduled-research-workflow/
├── plan.md              # This file
├── research.md          # Phase 0 output — 8 decisions with rationale
├── data-model.md        # Phase 1 output — GitHub entities (no DB changes)
├── quickstart.md        # Phase 1 output — setup and testing guide
├── contracts/
│   └── workflow-contract.md  # Phase 1 output — trigger, permissions, output format
├── spec.md              # Feature specification (14 FRs, 5 SCs)
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (repository root)

```text
.github/workflows/
└── research.yml         # NEW: Scheduled research workflow
```

**Structure Decision**: Single workflow file addition to the existing `.github/workflows/` directory. No application code changes, no new packages, no database migrations. The research prompt is embedded inline in the workflow YAML (standard pattern per Claude Code Action docs).

## Complexity Tracking

No constitution violations — this section is intentionally empty.
