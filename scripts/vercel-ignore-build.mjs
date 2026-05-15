#!/usr/bin/env node

const MAIN_BRANCH = "main";
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown commit";

if (branch === MAIN_BRANCH && !isGitHubActions) {
  console.log(
    `Skipping Vercel's automatic ${MAIN_BRANCH} deployment for ${sha}. GitHub Actions deploys production after CI passes.`,
  );
  // Vercel ignoreCommand semantics are inverted: exit 0 means "skip this build".
  process.exit(0);
}

if (branch === MAIN_BRANCH && isGitHubActions) {
  console.log(`Continuing GitHub Actions-managed ${MAIN_BRANCH} deployment after CI.`);
} else {
  console.log(
    `Continuing Vercel deployment for branch ${branch ?? "unknown branch"}; only ${MAIN_BRANCH} is gated by CI.`,
  );
}
// Non-zero means "do not ignore this build".
process.exit(1);
