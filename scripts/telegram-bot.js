const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

// Use token from env
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is missing in .env.local");
  process.exit(1);
}

const bot = new Telegraf(token);

const CODES_FILE = path.join(__dirname, 'invite_codes.json');

// Ensure codes file exists
if (!fs.existsSync(CODES_FILE)) {
  fs.writeFileSync(CODES_FILE, JSON.stringify({ codes: [] }));
}

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

bot.command('signup', (ctx) => {
  if (groupId && ctx.chat.id.toString() !== groupId) {
    return ctx.reply("Sorry, you can only generate signup codes from within the exclusive Telegram group!");
  }

  const data = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  const userStr = ctx.from.username || ctx.from.first_name;

  // Check if they already have an unused code
  const existingCode = data.codes.find(c => c.user === userStr);
  if (existingCode) {
    return ctx.reply(`You already have an unused signup code: ${existingCode.code}\n\nEnter this code on the registration page to create your account!`);
  }

  const newCode = generateCode();
  
  // Save to file (temporary until DB is up)
  data.codes.push({ 
    code: newCode, 
    user: userStr, 
    date: new Date() 
  });
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2));

  ctx.reply(`Here is your exclusive signup code: ${newCode}\n\nEnter this code on the registration page to create your account!`);
});

bot.launch().then(() => {
  console.log("Telegram Bot is running using Telegraf! Go to your Telegram app and type /start to your bot.");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
