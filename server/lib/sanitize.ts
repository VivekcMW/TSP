import type { User } from "@shared/models/auth";
import type { SocialAccount } from "@shared/schema";

// Kept as the seam between a `users` row and its JSON representation. The
// password-auth columns it used to strip (password_hash, reset_token,
// reset_token_expiry) were dropped with the Clerk migration, so there is
// currently nothing to remove — reinstate the destructuring here if a
// sensitive column is ever added.
export function toSafeUser(user: User) {
  return user;
}

// Strips OAuth access/refresh tokens before a row ever reaches a JSON response.
export function toSafeSocialAccount(account: SocialAccount) {
  const { accessToken, refreshToken, ...safe } = account;
  return safe;
}
