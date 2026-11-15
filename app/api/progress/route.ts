import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "../../../db";
import { conversations, games, lessonProgress } from "../../../db/schema";

async function authenticatedId() {
  const h = await headers();
  return h.get("oai-authenticated-user-id");
}

export async function GET() {
  const userId = await authenticatedId();
  if (!userId) return Response.json({ error: "Sign in is required" }, { status: 401 });
  try {
    const db = getDb();
    const [matchList, completedList, messages] = await Promise.all([
      db.select().from(games).where(eq(games.userId, userId)).orderBy(desc(games.id)).limit(60),
      db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)),
      db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.id)).limit(60),
    ]);
    return Response.json({
      games: matchList.map(g => ({ id: g.id, result: g.result, moves: JSON.parse(g.moves), turns: g.turns, createdAt: g.createdAt })),
      completed: completedList.map(l => l.lessonId),
      messages: messages.reverse().map(m => ({ role: m.sender, text: m.message, createdAt: m.createdAt })),
    });
  } catch (error) {
    console.error("Failed to load progress", error);
    return Response.json({ error: "Progress could not be loaded" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const userId = await authenticatedId();
  if (!userId) return Response.json({ error: "Sign in is required" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = getDb();
    if (body.type === "lesson") {
      const lessonId = typeof body.lessonId === "string" ? body.lessonId : "";
      if (!/^[a-z0-9-]{1,40}$/.test(lessonId)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
      await db.insert(lessonProgress).values({ userId, lessonId }).onConflictDoNothing();
      return Response.json({ ok: true });
    }
    if (body.type === "game") {
      const result = body.result;
      const moves = body.moves;
      if (!["black", "white", "draw"].includes(String(result)) || !Array.isArray(moves) || moves.length > 600 || !moves.every(x => typeof x === "string" && x.length < 12)) {
        return Response.json({ error: "Invalid game" }, { status: 400 });
      }
      await db.insert(games).values({ userId, result: String(result), moves: JSON.stringify(moves), turns: moves.length });
      return Response.json({ ok: true });
    }
    if (body.type === "chat") {
      const userText = typeof body.userText === "string" ? body.userText.trim().slice(0, 500) : "";
      const replyText = typeof body.replyText === "string" ? body.replyText.trim().slice(0, 1000) : "";
      if (!userText || !replyText) return Response.json({ error: "Empty chat" }, { status: 400 });
      await db.insert(conversations).values([
        { userId, sender: "user", message: userText },
        { userId, sender: "rival", message: replyText },
      ]);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to save progress", error);
    return Response.json({ error: "Progress could not be saved" }, { status: 500 });
  }
}
