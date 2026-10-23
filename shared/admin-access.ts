export const ADMIN_EMAILS = ["hello@thesocialpundit.com", "marketing@thesocialpundit.com"] as const;

export function isAdminIdentity(user: { email?: string | null; emailVerified?: boolean } | null | undefined): boolean {
  return user?.emailVerified === true && ADMIN_EMAILS.some(email => email === user.email?.trim().toLowerCase());
}

export function effectivePlatformRole(user: { email?: string | null; emailVerified?: boolean; platformRole?: string | null } | null | undefined) {
  if (!isAdminIdentity(user)) return null;
  return user?.platformRole === "platform_admin" || user?.platformRole === "platform_support" ? user.platformRole : null;
}
