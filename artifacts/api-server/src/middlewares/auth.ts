import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

export const SESSION_COOKIE = "stickman_session";
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  fullName: string;
  username: string;
  role: "user" | "admin";
  mustChangePassword: boolean;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: SessionUser;
      authSessionTokenHash?: string;
    }
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_LIFETIME_MS,
};

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 32) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select({
      tokenHash: sessionsTable.tokenHash,
      id: usersTable.id,
      fullName: usersTable.fullName,
      username: usersTable.username,
      role: usersTable.role,
      mustChangePassword: usersTable.mustChangePassword,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, tokenHash),
        gt(sessionsTable.expiresAt, new Date()),
        eq(usersTable.isActive, true),
      ),
    )
    .limit(1);

  if (!session) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    res.status(401).json({ error: "Your session has expired. Sign in again." });
    return;
  }

  const { tokenHash: _tokenHash, ...user } = session;
  req.authUser = user;
  req.authSessionTokenHash = tokenHash;
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.authUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  if (req.authUser.role !== "admin") {
    res.status(403).json({ error: "Administrator access is required." });
    return;
  }
  next();
};

export function safeUser(user: SessionUser): SessionUser {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}
