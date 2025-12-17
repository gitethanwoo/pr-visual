# pr-visual

Generate infographic images from your git diffs using Gemini AI.

**'Excalidraw' style:**

![Example](https://github.com/user-attachments/assets/ecea517e-36b0-4f1f-9bac-e7dbea6ccc19)

**'Clean' style:**

![example-clean](https://github.com/user-attachments/assets/f62e4a3a-bb08-4c2e-8253-6fb6e96093a3)

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
- Use [Gemini CLI](https://github.com/google-gemini/gemini-cli) to intelligently analyze the PR (can read files for context, not just the diff)
- Generate an infographic from the analysis
- Upload it to a GitHub Release (no commits to your PR branch!)
- Post a comment with the image and a collapsible prompt/history section

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
