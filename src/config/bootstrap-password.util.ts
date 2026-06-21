import { TEST_ADMIN_PASSWORD } from '../shared/test-users';

/** Dev/test bootstrap password — never used in production unless explicitly configured. */
export function resolveAdminBootstrapPassword(): string | null {
  const explicit =
    process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() ||
    process.env.GODADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== 'production') return TEST_ADMIN_PASSWORD;
  return null;
}
