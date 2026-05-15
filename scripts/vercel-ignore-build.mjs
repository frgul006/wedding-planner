#!/usr/bin/env node

const MAIN_BRANCH = "main";
const branch = process.env.VERCEL_GIT_COMMIT_REF;
const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown commit";

if (branch === MAIN_BRANCH) {
  console.log(
    `Skipping Vercel's automatic ${MAIN_BRANCH} deployment for ${sha}. GitHub Actions deploys production after CI passes.`,
  );
  // Vercel ignoreCommand semantics are inverted: exit 0 means "skip this build".
  process.exit(0);
}

console.log(
  `Continuing Vercel deployment for branch ${branch ?? "unknown branch"}; only ${MAIN_BRANCH} is gated by CI.`,
);
// Non-zero means "do not ignore this build".
process.exit(1);
