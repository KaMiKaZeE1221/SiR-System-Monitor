# GitHub Upload Guide

This environment currently does not have `git` and GitHub CLI available, so direct upload could not be automated here.

Use the steps below on a machine with Git installed.

## 1) Install prerequisites

- Install Git: https://git-scm.com/download/win
- Optional GitHub CLI: https://cli.github.com/

## 2) Initialize and commit

Run from project root:

```bash
git init
git add .
git commit -m "Initial commit: SiR System Monitor"
```

## 3) Create remote repository

### Option A: GitHub website

1. Create a new empty repository on GitHub.
2. Copy remote URL.
3. Run:

```bash
git branch -M main
git remote add origin <YOUR_REPO_URL>
git push -u origin main
```

### Option B: GitHub CLI

```bash
gh auth login
gh repo create <repo-name> --private --source . --remote origin --push
```

## 4) Add screenshots

Add screenshot files in `docs/screenshots/` using filenames listed in `docs/screenshots/README.md`, then commit and push:

```bash
git add docs/screenshots README.md
git commit -m "docs: add screenshots"
git push
```