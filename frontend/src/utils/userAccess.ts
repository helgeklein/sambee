import type { User } from "../types";

type UserAccessLike = Pick<User, "role"> | null | undefined;

export function isAdminUser(user: UserAccessLike): boolean {
  if (!user) {
    return false;
  }

  return user.role === "admin";
}

export function canUserWrite(user: UserAccessLike): boolean {
  if (!user?.role) {
    return false;
  }

  return user.role !== "viewer";
}
