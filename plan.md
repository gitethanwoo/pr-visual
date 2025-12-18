# pr-visual Roadmap

## Current State (v1)
- CLI tool: `npx pr-visual`
- GitHub Action for self-hosted automatic PR comments
- Uses Gemini CLI for analysis, Gemini Pro for image generation
- Auth: Google OAuth or GEMINI_API_KEY
- Free for users who bring their own API key

---

## Phase 2: Hosted Service + GitHub App

### Goal
Zero-friction: install GitHub App, every PR gets an image. No config, no API keys. Paid from day 1.

### Pricing Model
Usage-based via Polar:
- Image generation: ~$0.17 per image (14¢ cost + markup)
- Analysis: ~$0.02 minimum per analysis (variable + 20% markup)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         GitHub                               │
│  PR opened/synchronize → webhook POST to our Worker          │
└─────────────────────────────────┬───────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker                          │
│                                                              │
│  1. Verify webhook signature                                 │
│  2. Check billing status (Polar API)                         │
│  3. Fetch from GitHub API:                                   │
│     - PR diff (unified diff text)                            │
│     - Changed file contents (capped if huge)                 │
│  4. Call Gemini Flash API → creative brief                   │
│  5. Call Gemini Pro Image API → image bytes                  │
│  6. Upload image to R2                                       │
│  7. Post PR comment with image                               │
│  8. Report usage to Polar                                    │
└────────────┬──────────────┬──────────────┬──────────────────┘
             │              │              │
             ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │  Polar   │   │  Gemini  │   │    R2    │
      │ (billing)│   │   API    │   │ (images) │
      └──────────┘   └──────────┘   └──────────┘
```

### Key Decision: No Gemini CLI on Backend
- CF Workers can't run gemini-cli (no filesystem, no child_process)
- Instead: fetch diff + files via GitHub API, send to Gemini Flash directly
- Simpler, faster, cheaper
- If quality suffers, iterate on prompts or add more context

### GitHub App Permissions

```
Permissions:
- pull_requests: read   → get PR metadata
- pull_requests: write  → post comments
- contents: read        → read file contents

Events:
- pull_request.opened
- pull_request.synchronize
```

### Worker Endpoints

```
POST /webhooks/github     → receive PR events, generate images
GET  /health              → health check
```

### Idempotency
- Key: `{installation_id, repo, pr_number, head_sha}`
- Store in D1 or KV
- If already processed, skip (or return cached image URL)

### Image Storage
- Upload to Cloudflare R2
- Public URL in PR comment
- Retention: TBD (forever? 90 days?)

### Database (CF D1) - Minimal

```sql
processed_prs:
  id TEXT PRIMARY KEY           -- {installation}:{repo}:{pr}:{sha}
  image_url TEXT
  created_at INTEGER

installations:
  github_installation_id INTEGER PRIMARY KEY
  polar_customer_id TEXT
  created_at INTEGER
```

### Polar Setup

1. Create product: "pr-visual"
2. Create meter: `pr_visual_generation` - unit pricing ($0.19 per image)
   - Covers both analysis + image generation
   - Simpler than two separate meters
3. API: Check customer has payment method before generating

---

## Phase 3: One-Click Setup Flow

### User Journey

1. User runs `npx pr-visual` locally, loves it
2. Sees "Set up automatic PR visuals" option
3. Opens browser → GitHub App install page
4. Selects repos → redirects to Polar checkout
5. Adds payment method → done
6. Next PR gets automatic image comment

### No workflow files, no secrets, no config.

---

## Phase 4: Polish (Later)

- [ ] Style selector via PR comment command
- [ ] Re-generate button
- [ ] Usage dashboard
- [ ] Team/org billing

---

## Tech Stack

| Component | Tech |
|-----------|------|
| CLI | Node.js, TypeScript, gradient-string |
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 |
| Image Storage | Cloudflare R2 |
| Auth | GitHub App (installation token) |
| Payments | Polar (usage-based) |
| AI | Gemini Flash (analysis), Gemini Pro (images) |

---

## Implementation Order

1. **CF Worker scaffold** - wrangler project, basic endpoint
2. **Webhook handler** - verify signature, parse PR event
3. **GitHub API integration** - fetch diff + files
4. **Gemini integration** - brief + image generation
5. **R2 upload** - store image, get public URL
6. **PR comment** - post via GitHub API
7. **Polar billing** - check before generate, report after
8. **GitHub App** - create app, deploy, test end-to-end
