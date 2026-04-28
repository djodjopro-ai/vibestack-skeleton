import { createClerkClient } from "@clerk/express";
import { verifyToken } from "@clerk/backend";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { randomBytes } from "crypto";
import { db, users } from "./db.js";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

function getClerkClient() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) return null;
  return createClerkClient({ secretKey: key });
}

/**
 * Middleware: verifies Clerk session token or auto-authenticates in preview mode.
 * Sets req.userId on success.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Preview mode: auto-authenticate with a fixed preview user
  if (process.env.PREVIEW_MODE === "true") {
    let previewUser = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "preview@peply.dev"))
      .get();

    if (!previewUser) {
      const id = uuid();
      db.insert(users)
        .values({
          id,
          name: "Preview User",
          email: "preview@peply.dev",
          apiKey: randomBytes(24).toString("hex"),
          onboardingComplete: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      previewUser = { id };
    }

    (req as AuthenticatedRequest).userId = previewUser.id;
    return next();
  }

  // Clerk auth
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Auth not configured" });
    return;
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  const clerk = getClerkClient()!;

  verifyToken(token, { secretKey })
    .then(async (payload) => {
      const clerkUserId = payload.sub;

      // Find existing local user by Clerk ID
      let localUser = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId))
        .get();

      if (!localUser) {
        // Fetch Clerk user details for initial sync
        try {
          const clerkUser = await clerk.users.getUser(clerkUserId);
          const email =
            clerkUser.emailAddresses[0]?.emailAddress ?? "";
          const name =
            [clerkUser.firstName, clerkUser.lastName]
              .filter(Boolean)
              .join(" ") || "User";
          const id = uuid();
          db.insert(users)
            .values({
              id,
              clerkUserId,
              name,
              email,
              apiKey: randomBytes(24).toString("hex"),
              onboardingComplete: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .run();
          localUser = { id };
        } catch {
          res.status(401).json({ error: "Failed to verify user" });
          return;
        }
      }

      (req as AuthenticatedRequest).userId = localUser.id;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid token" });
    });
}

/**
 * Extract userId from an authenticated request.
 */
export function getUserId(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}
