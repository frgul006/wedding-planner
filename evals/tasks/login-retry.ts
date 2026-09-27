import type { EvaluationTask } from 'agent-evals';

/** Wedding's authored defect and grading expectations; the package knows none of these fields. */
export const loginRetry = {
  id: 'repository-login-retry',
  version: '2',
  prompt:
    'After an unsuccessful admin sign-in, correcting the credentials and trying again leaves the form stuck. Investigate and reproduce the failure, then repair retry behavior while preserving required-input validation, pending feedback and visible errors. You are authorized to use synthetic credentials against the provided local failure endpoint for reproduction and validation.',
  metadata: {
    repository: { revision: '30d2388f71595d1ba65d0d2fabc8b97b6ee48f80' },
    acceptance: 'admin-login-retry',
    targetFile: 'app/admin/login/login-form.tsx',
    expectedText: 'Invalid email or password.',
    flowPath: '/admin/login',
    diagnosis: 'required',
    validation: {
      required: true,
      targetFile: 'app/admin/login/login-form.tsx',
      requiredChecks: ['lint', 'build', 'browser_snapshot'],
      flowPath: '/admin/login',
      expectedText: 'Invalid email or password.',
    },
  },
} satisfies EvaluationTask;
