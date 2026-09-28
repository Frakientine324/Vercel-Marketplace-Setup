import { desc, eq, ne } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, marketplacePosts, type NewMarketplacePost, type StoredMedia } from "@workspace/db";
import { logger } from "../lib/logger.js";

type PostStatus = "pending" | "approved" | "rejected";

const router: IRouter = Router();

router.get("/marketplace/posts", async (_req, res) => {
  const posts = await db
    .select()
    .from(marketplacePosts)
    .where(ne(marketplacePosts.status, "rejected"))
    .orderBy(desc(marketplacePosts.createdAt));
  res.json(posts.map(toResponse));
});

router.post("/marketplace/posts", async (req, res) => {
  const parsed = parsePostBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Missing or invalid post fields." });
    return;
  }

  try {
    const [post] = await db.insert(marketplacePosts).values(parsed).returning();
    res.status(201).json(toResponse(post));
  } catch (error) {
    req.log.error({ err: error }, "Unable to save marketplace post");
    res.status(500).json({ error: "Unable to save marketplace post." });
  }
});

router.get("/marketplace/admin/posts", requireAdmin, async (_req, res) => {
  const posts = await db.select().from(marketplacePosts).orderBy(desc(marketplacePosts.createdAt));
  res.json(posts.map(toResponse));
});

router.post("/marketplace/admin/posts/:id/moderate", requireAdmin, async (req, res) => {
  const status = req.body?.status as PostStatus;
  const postId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!["approved", "rejected", "pending"].includes(status)) {
    res.status(400).json({ error: "Invalid moderation status." });
    return;
  }

  const [post] = await db
    .update(marketplacePosts)
    .set({
      status,
      moderationNote: typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null,
      updatedAt: new Date(),
    })
    .where(eq(marketplacePosts.id, postId))
    .returning();
  if (!post) {
    res.status(404).json({ error: "Post not found." });
    return;
  }

  await notifyTelegramStatus(post);
  res.json(toResponse(post));
});

router.post("/telegram/webhook", async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret || req.header("x-telegram-bot-api-secret-token") !== expectedSecret) {
    res.sendStatus(403);
    return;
  }

  const update = req.body;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const callback = update?.callback_query;
  const message = update?.message;

  try {
    if (message) {
      if (adminChatId && String(message.chat?.id) === adminChatId) {
        await handleTelegramMessage(message);
      }
      res.sendStatus(200);
      return;
    }

    if (!callback || !adminChatId || String(callback.message?.chat?.id) !== adminChatId) {
      res.sendStatus(200);
      return;
    }

    const [prefix, status, id] = String(callback.data ?? "").split(":");
    if (prefix !== "moderate" || !id || !["approved", "rejected", "pending"].includes(status)) {
      res.sendStatus(400);
      return;
    }

    const [post] = await db
      .update(marketplacePosts)
      .set({
        status,
        moderationNote: status === "rejected" ? "Rejected by Telegram owner moderation." : null,
        updatedAt: new Date(),
      })
      .where(eq(marketplacePosts.id, id))
      .returning();

    if (!post) {
      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "This post no longer exists.",
        show_alert: true,
      });
      res.sendStatus(404);
      return;
    }

    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: `Post ${status}.`,
    });
    await telegramRequest("editMessageReplyMarkup", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      reply_markup: { inline_keyboard: [] },
    });
    await notifyTelegramStatus(post);
    res.sendStatus(200);
  } catch (error) {
    logger.error({ err: error }, "Telegram webhook handling failed");
    res.sendStatus(500);
  }
});

function requireAdmin(req: Request, res: Response, next: () => void) {
  const expected = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!expected || req.header("x-admin-chat-id") !== expected) {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  next();
}

function parsePostBody(body: unknown): NewMarketplacePost | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const requiredStrings = ["title", "description", "type", "location", "category", "condition", "seller", "initials"];
  if (requiredStrings.some((key) => typeof value[key] !== "string" || !String(value[key]).trim())) return null;
  if (typeof value.price !== "number" || !Number.isFinite(value.price) || value.price < 0) return null;
  if (!Array.isArray(value.images)) return null;

  return {
    title: String(value.title).trim().slice(0, 160),
    description: String(value.description).trim().slice(0, 4000),
    price: String(value.price),
    type: String(value.type).slice(0, 40),
    location: String(value.location).slice(0, 100),
    category: String(value.category).slice(0, 60),
    condition: String(value.condition).slice(0, 60),
    seller: String(value.seller).slice(0, 100),
    initials: String(value.initials).slice(0, 8),
    images: sanitizeMedia(value.images),
    video: value.video ? sanitizeMediaItem(value.video) : null,
    status: "approved",
  };
}

function sanitizeMedia(value: unknown): StoredMedia[] {
  return Array.isArray(value) ? value.map(sanitizeMediaItem).filter(Boolean) as StoredMedia[] : [];
}

function sanitizeMediaItem(value: unknown): StoredMedia | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.url !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id.slice(0, 160),
    url: item.url.slice(0, 1000),
    name: item.name.slice(0, 255),
    ...(typeof item.objectPath === "string" ? { objectPath: item.objectPath.slice(0, 1000) } : {}),
  };
}

function toResponse(post: typeof marketplacePosts.$inferSelect) {
  return {
    ...post,
    price: Number(post.price),
    likes: 0,
    comments: 0,
    shares: 0,
    saved: false,
    liked: false,
  };
}

async function notifyTelegram(post: typeof marketplacePosts.$inferSelect) {
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID) {
    logger.warn("Telegram admin chat is not configured; moderation alert skipped");
    return;
  }

  const text = [
    "New marketplace post pending review",
    `Title: ${post.title}`,
    `Seller: ${post.seller}`,
    `Price: ₱${post.price}`,
    `Category: ${post.category}`,
    `Location: ${post.location}`,
    "",
    post.description.slice(0, 700),
  ].join("\n");
  await telegramRequest("sendMessage", {
    chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: "Approve", callback_data: `moderate:approved:${post.id}` },
        { text: "Reject", callback_data: `moderate:rejected:${post.id}` },
      ]],
    },
  });
}

async function notifyTelegramStatus(post: typeof marketplacePosts.$inferSelect) {
  if (!process.env.TELEGRAM_ADMIN_CHAT_ID) return;

  await telegramRequest("sendMessage", {
    chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
    text: `Moderation update: ${post.title} is now ${post.status}.`,
  });
}

async function handleTelegramMessage(message: TelegramMessage) {
  const chatId = message.chat?.id;
  const command = typeof message.text === "string" ? message.text.trim().split(/\s+/)[0] : "";

  if (!chatId || !command) return;

  if (command === "/start" || command === "/help") {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: [
        "Media Market moderation bot",
        "",
        "New seller posts appear here for review.",
        "Use /pending to show all posts waiting for approval.",
      ].join("\n"),
    });
    return;
  }

  if (command === "/pending") {
    const pendingPosts = await db
      .select()
      .from(marketplacePosts)
      .where(eq(marketplacePosts.status, "pending"))
      .orderBy(desc(marketplacePosts.createdAt));

    if (pendingPosts.length === 0) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: "There are no marketplace posts waiting for review.",
      });
      return;
    }

    for (const post of pendingPosts) {
      await sendPendingPostToTelegram(post, String(chatId));
    }
  }
}

async function sendPendingPostToTelegram(
  post: typeof marketplacePosts.$inferSelect,
  chatId = process.env.TELEGRAM_ADMIN_CHAT_ID,
) {
  if (!chatId) return;

  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: [
      "Marketplace post pending review",
      `Title: ${post.title}`,
      `Seller: ${post.seller}`,
      `Price: ₱${post.price}`,
      `Category: ${post.category}`,
      `Location: ${post.location}`,
      "",
      post.description.slice(0, 700),
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [[
        { text: "Approve", callback_data: `moderate:approved:${post.id}` },
        { text: "Reject", callback_data: `moderate:rejected:${post.id}` },
      ]],
    },
  });
}

export async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !secret || !adminChatId) {
    logger.warn("Telegram moderation is not fully configured; webhook registration skipped");
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    logger.info("Telegram webhook registration waits for the published production server");
    return;
  }

  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!domain) {
    logger.warn("No published domain is available; Telegram webhook registration skipped");
    return;
  }

  const normalizedDomain = domain.startsWith("http") ? domain : `https://${domain}`;
  const webhookUrl = `${normalizedDomain.replace(/\/+$/, "")}/api/telegram/webhook`;
  const registered = await telegramRequest("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });

  if (registered) {
    await telegramRequest("setMyCommands", {
      commands: [
        { command: "pending", description: "Show posts waiting for review" },
        { command: "help", description: "Show moderation help" },
      ],
    });
    logger.info({ webhookUrl }, "Telegram moderation webhook registered");
  }
}

type TelegramMessage = {
  chat?: { id?: number | string };
  text?: string;
};

async function telegramRequest(method: string, body: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn({ method }, "Telegram bot token is not configured");
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (!response.ok || payload.ok === false) {
      logger.error(
        { method, status: response.status, description: payload.description },
        "Telegram API request failed",
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error, method }, "Telegram API request failed");
    return false;
  }
}

export default router;