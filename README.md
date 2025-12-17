# pr-visual

Generate infographic images from your git diffs using Gemini AI.

![Example](https://raw.githubusercontent.com/gitethanwoo/pr-visual/main/.github/pr-visual/pr-1.png)

## Installation

```bash
npx pr-visual
```

Or install globally:

```bash
npm install -g pr-visual
```

## Authentication

**Option 1: Google OAuth (recommended)**

```bash
pr-visual login
```

Opens browser to authenticate with your Google account. Uses your own Gemini quota.

**Option 2: API Key**

```bash
export GEMINI_API_KEY=your_key_here
pr-visual
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

## Usage

### Interactive Mode

```bash
pr-visual
```

Walks you through selecting what to visualize and which style to use.

### Non-Interactive Mode

```bash
# Visualize branch diff
pr-visual --mode branch --yes

# Visualize staged changes
pr-visual --mode staged --yes

# Visualize a specific commit
pr-visual --mode commit --commit abc1234 --yes

# Custom output path
pr-visual --mode branch --yes --output my-visual.png
```

### Visual Styles

```bash
pr-visual --mode branch --style excalidraw --yes
```

| Style | Description |
|-------|-------------|
| `clean` | Corporate/PowerPoint style (default) |
| `excalidraw` | Hand-drawn whiteboard aesthetic |
| `minimal` | Simple, icon-heavy, lots of whitespace |
| `tech` | Dark mode with neon accents |
| `playful` | Colorful and fun with illustrations |

### Custom Prompts

Skip diff analysis and provide your own prompt:

```bash
pr-visual --prompt "Create an infographic showing a login flow" --yes
pr-visual --prompt-file my-prompt.txt --yes
```

## GitHub Action

Automatically generate and post infographics on PRs.

### Setup

1. Add `GEMINI_API_KEY` to your repository secrets
2. Create `.github/workflows/pr-visual.yml`:

```yaml
name: PR Visual

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  visualize:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gitethanwoo/pr-visual@v1
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          style: clean  # optional
```

The action will:
- Generate an infographic from the PR diff
- Commit it to `.github/pr-visual/` on the PR branch
- Post a comment with the embedded image

### Advanced: Agentic Mode with Gemini CLI

For complex PRs where raw diffs lack context, chain with [Gemini CLI](https://github.com/google-github-actions/run-gemini-cli) to let AI explore your codebase first:

```yaml
name: PR Visual (Agentic)

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  visualize:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # Step 1: Let Gemini CLI explore and understand the PR
      - name: Understand PR
        id: understand
        uses: google-github-actions/run-gemini-cli@v1
        with:
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          prompt: |
            Explore this PR. Read files as needed to understand what it does.
            Then write a concise creative brief for an infographic.
            Scale complexity to the change - small fixes need simple visuals.
            Output ONLY the brief.

      # Step 2: Generate visual from the brief
      - uses: gitethanwoo/pr-visual@v1
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
          prompt: ${{ steps.understand.outputs.summary }}
```

This approach produces better visuals because Gemini can read the actual code, not just the diff.

## CLI Reference

```
pr-visual [command] [options]

Commands:
  login     Login with Google OAuth
  logout    Clear stored credentials
  status    Show authentication status
  (none)    Generate infographic (default)

Options:
  -h, --help              Show help
  -m, --mode <mode>       Diff mode: branch, commit, staged, unstaged
  -s, --style <style>     Visual style: clean, excalidraw, minimal, tech, playful
  -p, --prompt <text>     Custom prompt (bypasses diff analysis)
  --prompt-file <path>    Read prompt from file
  -c, --commit <hash>     Commit hash (for mode=commit)
  -y, --yes               Skip confirmation prompt
  -o, --output <path>     Output file path
```

## License

ISC
