# Enabling the cron workflows

The 4 GitHub Actions cron workflows + the reusable runner live in **`deploy/workflows/`**
instead of `.github/workflows/` for one reason: the `gh` CLI token used to create
this repo had `repo` scope but **not `workflow` scope**, and GitHub refuses to push
files into `.github/workflows/` without it. Everything else is already live.

## To turn the crons on (one-time, ~30 seconds at a desktop)

```bash
# 1. grant the workflow scope (opens a browser / device-code flow)
gh auth refresh -h github.com -s workflow

# 2. move the workflows into place and push
cd wc26-prediction-machine
git mv deploy/workflows .github/workflows
git commit -m "ci: enable cron workflows"
git push origin main
```

That's it — `main-update`, `lock-job`, `live-status` and `daily-housekeeping`
will start running on their crons (and appear in the repo's **Actions** tab, where
you can also trigger each manually via *Run workflow*).

## Before they'll do anything useful

Set the remaining Actions secrets (Settings → Secrets and variables → Actions):

| Secret | Status |
|---|---|
| `PREDICTION_MODEL_GROUP` | ✅ already set (`claude-sonnet-4-6`) |
| `PREDICTION_MODEL_KO` | ✅ already set (`claude-opus-4-8`) |
| `ANTHROPIC_API_KEY` | ⬜ needed |
| `FOOTBALL_API_KEY` | ⬜ needed (free tier) |
| `RENDER_DEPLOY_HOOK` | ⬜ optional |

Set the two keys with:

```bash
gh secret set ANTHROPIC_API_KEY --body "sk-ant-..."
gh secret set FOOTBALL_API_KEY --body "..."
```
