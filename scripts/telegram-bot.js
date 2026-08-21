require('dotenv').config({ path: '../.env.local' });
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

// Replace with token if not in env
const token = process.env.TELEGRAM_BOT_TOKEN || '8771430790:AAFIiKz_Rj4-HxUjvIGot1WY7mDydRiRgcc';

const bot = new Telegraf(token);

const CODES_FILE = path.join(__dirname, 'invite_codes.json');

// Ensure codes file exists
if (!fs.existsSync(CODES_FILE)) {
  fs.writeFileSync(CODES_FILE, JSON.stringify({ codes: [] }));
}

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

bot.start((ctx) => ctx.reply('Welcome to OFMReddit! To get your exclusive signup code, type /signup'));

bot.command('signup', (ctx) => {
  const newCode = generateCode();
  
  // Save to file (temporary until DB is up)
  const data = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  data.codes.push({ 
    code: newCode, 
    user: ctx.from.username || ctx.from.first_name, 
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
