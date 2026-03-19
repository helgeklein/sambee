import type { User } from "../types";

type UserAccessLike = Pick<User, "is_admin" | "role"> | null | undefined;

export function isAdminUser(user: UserAccessLike): boolean {
  if (!user) {
    return false;
  }

  return user.is_admin || user.role === "admin";
}
