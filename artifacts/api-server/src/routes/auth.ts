import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, count, eq, gt } from "drizzle-orm";
import {
  ChangePasswordBody,
  GetCurrentUserResponse,
  LogInBody,
  LogInResponse,
  SignUpBody,
  SignUpResponse,
} from "@workspace/api-zod";
import { db, sessionsTable, usersTable } from "@workspace/db";
import {
  hashSessionToken,
  requireAuth,
  safeUser,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  sessionCookieOptions,
} from "../middlewares/auth";
import { hashPassword, secureStringEquals, verifyPassword } from "../lib/passwords";

const router: IRouter = Router();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginAttemptKey(req: { ip?: string; body?: unknown }): string {
  const body = req.body as { username?: unknown } | undefined;
  const username = typeof body?.username === "string" ? body.username.toLowerCase() : "unknown";
  return `${req.ip ?? "unknown"}:${username}`;
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  for (const [entryKey, record] of loginAttempts) {
    if (record.resetAt <= now) loginAttempts.delete(entryKey);
  }
  const record = loginAttempts.get(key);
  return Boolean(record && record.count >= MAX_LOGIN_ATTEMPTS && record.resetAt > now);
}

function recordFailedLogin(key: string): void {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || record.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  record.count += 1;
}

async function createSession(userId: string, res: Response): Promise<void> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.insert(sessionsTable).values({
    tokenHash: hashSessionToken(rawToken),
    userId,
    expiresAt,
  });
  res.cookie(SESSION_COOKIE, rawToken, sessionCookieOptions);
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a name, a username, and a password of at least 12 characters." });
    return;
  }

  const fullName = parsed.data.fullName.trim();
  const username = parsed.data.username.trim().toLowerCase();
  const bootstrapUsername = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim().toLowerCase();
  const isBootstrapAccount = Boolean(bootstrapUsername && username === bootstrapUsername);

  let role: "user" | "admin" = "user";
  if (parsed.data.bootstrapToken && !isBootstrapAccount) {
    res.status(400).json({ error: "Admin setup is only available for the configured owner account." });
    return;
  }
  if (isBootstrapAccount) {
    const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!expectedToken) {
      res.status(503).json({ error: "Admin setup is not configured yet." });
      return;
    }
    if (
      !parsed.data.bootstrapToken ||
      !secureStringEquals(parsed.data.bootstrapToken, expectedToken)
    ) {
      res.status(403).json({ error: "The admin setup code is invalid." });
      return;
    }
    const [adminCount] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    if (Number(adminCount?.value ?? 0) > 0) {
      res.status(409).json({ error: "Initial admin setup has already been claimed." });
      return;
    }
    role = "admin";
  }

  const password = await hashPassword(parsed.data.password);
  try {
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(usersTable)
        .values({
          fullName,
          username,
          passwordHash: password.hash,
          passwordSalt: password.salt,
          role,
        })
        .returning({
          id: usersTable.id,
          fullName: usersTable.fullName,
          username: usersTable.username,
          role: usersTable.role,
          mustChangePassword: usersTable.mustChangePassword,
        });

      if (!created) throw new Error("Account creation failed.");

      const rawToken = randomBytes(32).toString("base64url");
      await tx.insert(sessionsTable).values({
        tokenHash: hashSessionToken(rawToken),
        userId: created.id,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      });
      return { created, rawToken };
    });

    res.cookie(SESSION_COOKIE, user.rawToken, sessionCookieOptions);
    res.status(201).json(SignUpResponse.parse(safeUser(user.created)));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    req.log.error({ err: error }, "Account signup failed");
    res.status(500).json({ error: "Account could not be created. Try again." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LogInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your username and password." });
    return;
  }

  const key = loginAttemptKey(req);
  if (isLoginRateLimited(key)) {
    res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, parsed.data.username.trim().toLowerCase()))
    .limit(1);

  if (
    !user ||
    !user.isActive ||
    !(await verifyPassword(parsed.data.password, user.passwordHash, user.passwordSalt))
  ) {
    recordFailedLogin(key);
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  loginAttempts.delete(key);
  await createSession(user.id, res);
  res.json(
    LogInResponse.parse({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    }),
  );
});

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  if (req.authSessionTokenHash) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, req.authSessionTokenHash));
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, (req, res): void => {
  if (!req.authUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(safeUser(req.authUser)));
});

router.post("/auth/password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success || !req.authUser || !req.authSessionTokenHash) {
    res.status(400).json({ error: "The new password must be at least 12 characters." });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.authUser.id))
    .limit(1);
  if (
    !user ||
    !(await verifyPassword(
      parsed.data.currentPassword,
      user.passwordHash,
      user.passwordSalt,
    ))
  ) {
    res.status(401).json({ error: "The current password is incorrect." });
    return;
  }

  const password = await hashPassword(parsed.data.newPassword);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        passwordHash: password.hash,
        passwordSalt: password.salt,
        mustChangePassword: false,
      })
      .where(eq(usersTable.id, user.id));
    await tx
      .delete(sessionsTable)
      .where(
        and(
          eq(sessionsTable.userId, user.id),
          gt(sessionsTable.expiresAt, new Date()),
        ),
      );
    const rawToken = randomBytes(32).toString("base64url");
    await tx.insert(sessionsTable).values({
      tokenHash: hashSessionToken(rawToken),
      userId: user.id,
      expiresAt,
    });
    res.cookie(SESSION_COOKIE, rawToken, sessionCookieOptions);
  });

  res.sendStatus(204);
});

export default router;
