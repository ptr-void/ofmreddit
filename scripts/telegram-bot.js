const { Telegraf } = require('telegraf');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const mysql = require('mysql2/promise');

// Use token from env
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is missing in .env.local");
  process.exit(1);
}

const bot = new Telegraf(token);

// DB Connection
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "nibba",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const groupId = process.env.TELEGRAM_GROUP_ID;

bot.start((ctx) => {
  if (groupId && ctx.chat.id.toString() !== groupId) {
    return ctx.reply("Sorry, this bot is restricted to members of the exclusive group.");
  }
  ctx.reply('Welcome to OFMReddit! To get your exclusive signup code, type /signup')
});

bot.command('signup', async (ctx) => {
  console.log("DEBUG - Incoming Chat ID:", ctx.chat.id);
  console.log("DEBUG - Expected Group ID:", groupId);
  
  if (groupId && ctx.chat.id.toString() !== groupId) {
    return ctx.reply(`Sorry, you can only generate signup codes from within the exclusive Telegram group! (Debug: Your Chat ID is ${ctx.chat.id})`);
  }

  const userStr = ctx.from.username || ctx.from.first_name;

  try {
    // Check if they already have an unused code
    const [rows] = await pool.execute('SELECT code FROM invite_codes WHERE user_name = ?', [userStr]);
    
    if (rows.length > 0) {
      return ctx.reply(`You already have an unused signup code: ${rows[0].code}\n\nEnter this code on the registration page to create your account!`);
    }

    const newCode = generateCode();
    
    // Save to DB
    await pool.execute('INSERT INTO invite_codes (code, user_name) VALUES (?, ?)', [newCode, userStr]);

    ctx.reply(`Here is your exclusive signup code: ${newCode}\n\nEnter this code on the registration page to create your account!`);
  } catch (error) {
    console.error("Database error:", error);
    ctx.reply("Sorry, there was an error generating your code. Please try again later.");
  }
});

bot.launch().then(() => {
  console.log("Telegram Bot is running using Telegraf! Go to your Telegram app and type /start to your bot.");
});

// Enable graceful stop
process.once('SIGINT', () => { bot.stop('SIGINT'); pool.end(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); pool.end(); });
