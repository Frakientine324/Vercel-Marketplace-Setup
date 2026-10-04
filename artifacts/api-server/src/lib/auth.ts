import crypto from 'crypto';
import type { AuthUser } from '@workspace/api-zod';
import { db, sessionsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { type Request, type Response } from 'express';
import * as client from 'openid-client';

export const ISSUER_URL =
  process.env.ISSUER_URL ?? 'https://replit.com/oidc';

export const SESSION_COOKIE = 'sid';

export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;

/**
 * Get OpenID Connect configuration.
 */
export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    const clientId = process.env.REPL_ID;

    if (!clientId) {
      throw new Error(
        'REPL_ID environment variable is missing. Configure REPL_ID in the deployment environment.',
      );
    }

    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      clientId,
    );
  }

  return oidcConfig;
}

/**
 * Create a new server-side session.
 */
export async function createSession(
  data: SessionData,
): Promise<string> {
  const sid = crypto.randomBytes(32).toString('hex');

  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });

  return sid;
}

/**
 * Get a session by session ID.
 */
export async function getSession(
  sid: string,
): Promise<SessionData | null> {
  if (!sid) {
    return null;
  }

  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row) {
    return null;
  }

  if (row.expire < new Date()) {
    await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

/**
 * Update an existing session and extend its expiration.
 */
export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  if (!sid) {
    return;
  }

  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

/**
 * Delete a session.
 */
export async function deleteSession(
  sid: string,
): Promise<void> {
  if (!sid) {
    return;
  }

  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.sid, sid));
}

/**
 * Clear the session from the database and browser cookie.
 */
export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) {
    await deleteSession(sid);
  }

  res.clearCookie(SESSION_COOKIE, {
    path: '/',
  });
}

/**
 * Read the session ID from:
 * 1. Authorization: Bearer <session-id>
 * 2. sid cookie
 */
export function getSessionId(
  req: Request,
): string | undefined {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader
      .slice('Bearer '.length)
      .trim();

    if (token) {
      return token;
    }
  }

  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const trimmed = cookie.trim();

    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const name = trimmed
      .slice(0, separatorIndex)
      .trim();

    if (name !== SESSION_COOKIE) {
      continue;
    }

    const value = trimmed
      .slice(separatorIndex + 1)
      .trim();

    if (!value) {
      return undefined;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}
