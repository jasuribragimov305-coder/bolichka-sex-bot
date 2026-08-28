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
const { runKassaCheck } = require("./src/kassaCheck");
const { isRateLimited, clientIp, safeEqual } = require("./src/rateLimit");
const { snapToRoads } = require("./src/roadsSnap");

// Tashqi (GitHub Actions) cron shu maxfiy so'z bilan har kuni soat 20:00'da
// /cron/kassa-check'ni chaqiradi — hech qanday pullik xizmat kerak emas.
// Ochiq repo'da saqlangani uchun (workflow scope cheklovi tufayli boshqa
// iloj bo'lmadi) maxfiy so'z oshkor bo'lib qolishi mumkin deb hisoblaymiz —
// shuning uchun pastda alohida "necha daqiqada bir marta" cheklovi ham bor,
// hatto kimdir so'zni bilsa ham suiiste'mol qila olmasin.
const CRON_SECRET = "fccd19e4c726d4ea339cd7ee0b59485f588d86bc8bd0c872";
const CRON_MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastCronRunAt = 0;

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

bot.on("location", async (ctx) => {
  const s = getSession(ctx.chat.id);
  if (!s.employee || !s.step) return;
  const roleHandler = roleHandlers[s.employee.role];
  if (roleHandler && roleHandler.handleLocation) await roleHandler.handleLocation(ctx, s);
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
    // Telegram'ning o'zi webhook so'rovlarini o'z serverlaridan yuboradi —
    // ko'p xodim bir vaqtda yozsa ham, hammasi Telegram'ning bir nechta IP
    // manzilidan "proksi" bo'lib keladi. Shuning uchun tezlik cheklovini
    // FAQAT webhook'dan tashqari yo'llarga qo'llaymiz — aks holda gavjum
     // paytda haqiqiy xabarlar bekor qilinib qolishi mumkin edi.
    if (req.url !== webhookPath && isRateLimited(clientIp(req))) {
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too many requests");
      return;
    }
    if (req.url === "/" || req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    if (req.url === webhookPath && req.method === "POST") {
      return bot.webhookCallback(webhookPath)(req, res);
    }
    if (req.url.startsWith("/cron/kassa-check")) {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      const providedSecret = reqUrl.searchParams.get("secret") || "";
      if (!safeEqual(providedSecret, CRON_SECRET)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const now = Date.now();
      if (now - lastCronRunAt < CRON_MIN_INTERVAL_MS) {
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("Yaqinda ishga tushirilgan, biroz kuting");
        return;
      }
      lastCronRunAt = now;
      try {
        await runKassaCheck(bot);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } catch (err) {
        console.error("Kassa nazorati xatoligi:", err);
        res.writeHead(500);
        res.end("error");
      }
      return;
    }
    if (req.url === "/api/snap-to-roads") {
      // Admin sayt (bolichka-sex.web.app) brauzerdan chaqiradi — CORS kerak.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const { points } = JSON.parse(body || "{}");
          const snapped = await snapToRoads(points);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ points: snapped }));
        } catch (err) {
          console.error("Yo'lga moslashtirish xatoligi:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ points: [] }));
        }
      });
      return;
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
  bot.launch().then(() => console.log("Bolichka boti (uzun-so'rov rejimida) ishga tushdi."));
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
