# Quickstart: Scheduled Research Workflow

## Prerequisites

1. **Anthropic API Key**: Obtain from [console.anthropic.com](https://console.anthropic.com)
2. **GitHub Personal Access Token (PAT)**: Create with `repo` scope at GitHub Settings > Developer settings > Personal access tokens

## Setup (2 minutes)

### 1. Add Repository Secrets

Go to **Settings > Secrets and variables > Actions** and add:

| Secret Name | Value |
| ----------- | ----- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `PERSONAL_ACCESS_TOKEN` | Your GitHub PAT with `repo` scope |

### 2. Create the Workflow File

The workflow file goes at `.github/workflows/research.yml`. This will be created by the implementation task.

### 3. Test via Manual Trigger

1. Go to **Actions** tab in GitHub
2. Select **"Scheduled Research"** workflow
3. Click **"Run workflow"**
4. Optionally enter a focus area (e.g., "memory system")
5. Click **"Run workflow"** button
6. Monitor the run — issues will appear in the **Issues** tab

### 4. Verify

- Check the **Issues** tab for new issues with the `research` label
- Each issue should have the title format: `research: [area] - [summary]`
- If no findings, check the workflow run logs for the evaluation summary

## Schedule

The workflow runs automatically every 12 hours (`0 */12 * * *`). To change the schedule, edit the `cron` expression in `.github/workflows/research.yml`.

## Cost Expectations

Each run uses approximately:
- **Claude API tokens**: Variable based on codebase size and research depth (capped at 30 turns)
- **GitHub Actions minutes**: ~10-15 minutes on ubuntu-latest per run
- **Frequency**: 2 runs per day = ~20-30 minutes of Actions time daily
