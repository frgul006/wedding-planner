# Invite motion review

Temporary #78 review aid for judging invite panel motion with real frames.

## Live review page

1. Start local data/app:

   ```bash
   pnpm supabase:start
   pnpm seed:local
   pnpm dev
   ```

2. Open:

   ```text
   http://localhost:3000/invite-motion-review.html
   ```

3. Use scripted scenarios or manual touch scrub to check:

   - follow-finger drag
   - snap-back
   - committed release
   - arrow navigation
   - dot navigation
   - internal CTA/link navigation
   - edge resistance
   - transitions between panels with different heights
   - reduced-motion mode via the local-dev-only `?motionReviewReduced=1` toggle

4. Copy the PR review block from the page and paste it into the implementation PR.

## Filmstrip artifact

For a shareable frame-by-frame HTML artifact, run this while the local app is up:

```bash
node scripts/capture-invite-motion-review.mjs
```

Default output:

```text
artifacts/invite-motion-review/index.html
```

`artifacts/` is git-ignored. Attach the generated HTML folder or screenshots to the PR/review notes when needed. If one scenario fails, the script still writes a partial artifact and exits non-zero so the captured frames can be inspected. This artifact is for human review only; do not turn it into a brittle CI baseline.

Useful override:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 node scripts/capture-invite-motion-review.mjs
```
