require("dotenv").config();
const http = require("http");
const { Telegraf } = require("telegraf");
const { getSession, loadSessionFromFirestore, saveSessionToFirestore } = require("./src/session");

const login = require("./src/flows/login");
const pichuvchi = require("./src/flows/pichuvchi");
const fasovkachi = require("./src/flows/fasovkachi");
const sotuvchi = require("./src/flows/sotuvchi");
const kassir = require("./src/flows/kassir");
const adminFlow = require("./src/flows/admin");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN topilmadi — .env faylini tekshiring.");
  process.exit(1);
}

const bot = new Telegraf(token);

// Cloud Run "so'rov kelganda ishga tushadi" (scale to zero) — har bir
// yangilanishdan oldin shu chat'ning holatini Firestore'dan xotiraga
// yuklaymiz, ishlov tugagach qayta yozib qo'yamiz. Mahalliy uzun-so'rov
// (long-polling) rejimida ham zarar qilmaydi, faqat ortiqcha ikkita
// Firestore chaqiruvi bo'ladi.
bot.use(async (ctx, next) => {
  const chatId = ctx.chat && ctx.chat.id;
  if (chatId != null) await loadSessionFromFirestore(chatId);
  await next();
  if (chatId != null) await saveSessionToFirestore(chatId);
});

const loginHandlers = login.register(bot);
const roleHandlers = {
  pichuvchi: pichuvchi.register(bot),
  fasovkachi: fasovkachi.register(bot),
  haydovchi: sotuvchi.register(bot),
  kassir: kassir.register(bot),
  admin: adminFlow.register(bot),
};

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return; // buyruqlar alohida ro'yxatdan o'tgan
  const s = getSession(ctx.chat.id);

  if (!s.employee) {
    const handled = await loginHandlers.handleText(ctx, s, text);
    if (!handled) await ctx.reply("Iltimos, /start bilan boshlang.");
    return;
  }

  const roleHandler = roleHandlers[s.employee.role];
  if (s.step && roleHandler) {
    const handled = await roleHandler.handleText(ctx, s, text);
    if (handled) return;
  }
  await ctx.reply("Menyudan tanlang: /menu");
});

bot.catch((err, ctx) => {
  console.error("Bot xatoligi:", err);
  ctx.reply("⚠️ Xatolik yuz berdi. /menu orqali qaytadan urinib ko'ring.").catch(() => {});
});

process.on("unhandledRejection", (err) => {
  console.error("Kutilmagan xatolik (jarayon davom etadi):", err);
});

// Cloud Run har doim PORT env'ni beradi — shu bo'lsa webhook (HTTP) rejimida,
// bo'lmasa (mahalliy kompyuterda) uzun-so'rov (long-polling) rejimida ishlaydi.
const port = process.env.PORT;
if (port) {
  const webhookPath = `/webhook/${token}`;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.url === webhookPath && req.method === "POST") {
      return bot.webhookCallback(webhookPath)(req, res);
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, async () => {
    console.log(`HTTP server ${port} portda ishga tushdi.`);
    const publicUrl = process.env.WEBHOOK_URL;
    if (publicUrl) {
      await bot.telegram.setWebhook(`${publicUrl}${webhookPath}`);
      console.log("Webhook o'rnatildi:", `${publicUrl}${webhookPath}`);
    } else {
      console.log("WEBHOOK_URL berilmagan — webhook o'rnatilmadi, uni qo'lda o'rnatish kerak.");
    }
  });
} else {
  bot.launch().then(() => console.log("Bolichka sex boti (uzun-so'rov rejimida) ishga tushdi."));
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
