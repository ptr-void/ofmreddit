import { NextResponse } from "next/server";
import { Telegraf } from "telegraf";
import { query } from "@/lib/db";

const token = process.env.TELEGRAM_BOT_TOKEN;
const groupId = process.env.TELEGRAM_GROUP_ID;

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing");
}

const bot = new Telegraf(token || "");

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

bot.start((ctx) => {
  ctx.reply("Welcome to OFMReddit! To get your exclusive signup code, type /signup");
});

bot.command("getid", (ctx) => {
  console.log("DEBUG - Chat ID:", ctx.chat.id);
  ctx.reply(`This chat's ID is: ${ctx.chat.id}`);
});

bot.command("signup", async (ctx) => {
  if (ctx.chat.type !== "private") {
    return ctx.reply("Please send me a direct message (DM) to get your signup code!");
  }

  if (groupId) {
    try {
      const member = await ctx.telegram.getChatMember(groupId, ctx.from.id);
      if (member.status === "left" || member.status === "kicked") {
        return ctx.reply("Sorry, you must be a member of the exclusive Telegram group to generate a signup code!\n\nJoin here: @ofmredditcommunity");
      }
    } catch (error) {
      console.error("Error checking group membership:", error);
      return ctx.reply("Sorry but you must be a member of @ofmredditcommunity in order to receive a sign up code.\n\nJoin here: @ofmredditcommunity");
    }
  }

  const userStr = ctx.from.username || ctx.from.first_name || "Unknown";

  try {
    // Check if they are already registered on the website
    const existingUser = await query<{ id: number }>(
      "SELECT id FROM users WHERE telegram_username = ?",
      [userStr]
    );

    if (existingUser.length > 0) {
      return ctx.reply("Your Telegram account is already linked to an active OFMReddit account! You cannot generate another code.");
    }

    const existingCode = await query<{ code: string }>(
      "SELECT code FROM invite_codes WHERE user_name = ?",
      [userStr]
    );

    if (existingCode.length > 0) {
      return ctx.reply(`You already have an unused signup code: ${existingCode[0].code}\n\nEnter this code on the registration page to create your account!`);
    }

    const newCode = generateCode();

    await query("INSERT INTO invite_codes (code, user_name) VALUES (?, ?)", [newCode, userStr]);

    ctx.reply(`Here is your exclusive signup code: ${newCode}\n\nEnter this code on the registration page to create your account!`);
  } catch (error) {
    console.error("Database error:", error);
    ctx.reply("Sorry, there was an error generating your code. Please try again later.");
  }
});

export async function POST(req: Request) {
  if (!token) {
    return NextResponse.json({ error: "Bot token not configured" }, { status: 500 });
  }

  try {
    const update = await req.json();
    await bot.handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("Error handling update:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
