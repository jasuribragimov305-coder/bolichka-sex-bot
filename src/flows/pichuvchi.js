const { Markup } = require("telegraf");
const { db, admin } = require("../firebase");
const { getSession, resetStep } = require("../session");
const { mainMenuFor } = require("../menu");
const { todayKey, listProducts, grid } = require("../helpers");

function register(bot) {
  bot.action("cut:start", async (ctx) => {
    await ctx.answerCbQuery();
    const products = await listProducts();
    if (products.length === 0) {
      await ctx.reply("Hali mahsulot yo'q.");
      return;
    }
    const kb = grid(products, (p) => Markup.button.callback(p.name, `cut:prod:${p.id}`));
    await ctx.reply("Qaysi mahsulotni kesdingiz?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^cut:prod:(.+)$/, async (ctx) => {
    const productId = ctx.match[1];
    const s = getSession(ctx.chat.id);
    s.draft = { productId };
    s.step = "cut.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Necha kg? (masalan: 50)");
  });

  bot.action("cut:today", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db
      .collection("cutLogs")
      .where("employeeUid", "==", s.employee.uid)
      .where("date", "==", todayKey())
      .get();
    const total = snap.docs.reduce((sum, d) => sum + (d.data().qty || 0), 0);
    await ctx.reply(`📊 Bugun kesganingiz: *${total} kg* (${snap.size} ta yozuv)`, { parse_mode: "Markdown" });
  });

  return {
    async handleText(ctx, s, text) {
      if (s.step === "cut.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("Iltimos, to'g'ri son kiriting (masalan: 50).");
          return true;
        }
        await db.collection("cutLogs").add({
          employeeUid: s.employee.uid,
          employeeName: s.employee.name,
          productId: s.draft.productId,
          qty,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Qo'shildi: ${qty} kg`, mainMenuFor(s.employee.role));
        return true;
      }
      return false;
    },
  };
}

module.exports = { register };
