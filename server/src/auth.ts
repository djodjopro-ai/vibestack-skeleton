import { eq } from "drizzle-orm";
import { db, users } from "./db.js";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * Middleware: validates API key from Authorization header.
 * Sets req.userId on success.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const apiKey = authHeader.slice(7);

  const user = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .get();

  if (!user) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  (req as AuthenticatedRequest).userId = user.id;
  next();
}

/**
 * Extract userId from an authenticated request.
 */
export function getUserId(req: Request): string {
  return (req as AuthenticatedRequest).userId;
}
