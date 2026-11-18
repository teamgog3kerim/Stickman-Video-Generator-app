import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { asc, count, eq } from "drizzle-orm";
import {
  ListAdminUsersResponse,
  ResetUserPasswordParams,
  ResetUserPasswordResponse,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
  UpdateUserRoleResponse,
} from "@workspace/api-zod";
import { db, projectsTable, sessionsTable, usersTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { hashPassword } from "../lib/passwords";

const router: IRouter = Router();
router.use(requireAuth, requireAdmin);

router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      username: usersTable.username,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
      projectCount: count(projectsTable.id),
      mustChangePassword: usersTable.mustChangePassword,
    })
    .from(usersTable)
    .leftJoin(projectsTable, eq(projectsTable.userId, usersTable.id))
    .groupBy(usersTable.id)
    .orderBy(asc(usersTable.createdAt));
  res.json(ListAdminUsersResponse.parse(users));
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const params = UpdateUserRoleParams.safeParse(req.params);
  const body = UpdateUserRoleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Account role is invalid." });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  if (target.role === "admin" && body.data.role === "user") {
    const [adminCount] = await db
      .select({ value: count() })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));
    if (Number(adminCount?.value ?? 0) <= 1) {
      res.status(400).json({ error: "The last administrator cannot be removed." });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role: body.data.role })
    .where(eq(usersTable.id, target.id))
    .returning({
      id: usersTable.id,
      fullName: usersTable.fullName,
      username: usersTable.username,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
      mustChangePassword: usersTable.mustChangePassword,
    });
  if (!updated) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  const [projectCount] = await db
    .select({ value: count() })
    .from(projectsTable)
    .where(eq(projectsTable.userId, updated.id));
  res.json(
    UpdateUserRoleResponse.parse({
      ...updated,
      projectCount: Number(projectCount?.value ?? 0),
    }),
  );
});

router.post("/admin/users/:id/reset-password", async (req, res): Promise<void> => {
  const params = ResetUserPasswordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Account ID is invalid." });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "Account not found." });
    return;
  }

  const temporaryPassword = randomBytes(18).toString("base64url");
  const password = await hashPassword(temporaryPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({
        passwordHash: password.hash,
        passwordSalt: password.salt,
        mustChangePassword: true,
      })
      .where(eq(usersTable.id, target.id));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, target.id));
  });

  res.json(
    ResetUserPasswordResponse.parse({
      temporaryPassword,
      username: target.username,
    }),
  );
});

export default router;
