const { Markup } = require("telegraf");
const { db, admin } = require("../firebase");
const { getSession, resetStep } = require("../session");
const { mainMenuFor } = require("../menu");
const { todayKey, money, vehicleLabel } = require("../helpers");

async function employeeName(uid) {
  const doc = await db.collection("employees").doc(uid).get();
  return doc.exists ? doc.data().name : uid;
}
async function vehicleNameOf(id) {
  const doc = await db.collection("vehicles").doc(id).get();
  return doc.exists ? vehicleLabel({ id, ...doc.data() }) : id;
}

function register(bot) {
  bot.action("kassir:loads", async (ctx) => {
    await ctx.answerCbQuery();
    const dlSnap = await db.collection("driverLoads").where("date", "==", todayKey()).get();
    if (dlSnap.empty) {
      await ctx.reply("Bugun hali hech kim yo'lga chiqmagan.");
      return;
    }
    for (const dlDoc of dlSnap.docs) {
      const dl = { id: dlDoc.id, ...dlDoc.data() };
      const closureSnap = await db.collection("dayClosures").where("driverLoadId", "==", dl.id).limit(1).get();
      const driverName = await employeeName(dl.driverUid);
      const vName = await vehicleNameOf(dl.vehicleId);
      if (!closureSnap.empty) {
        const c = closureSnap.docs[0].data();
        const icon = c.status === "match" ? "✓ mos keldi" : "⚠ farq bor";
        await ctx.reply(`${driverName} — ${vName}\n${icon}, qabul qilingan: ${money.format(c.receivedCash)} so'm`);
        continue;
      }
      const delSnap = await db.collection("deliveries").where("driverLoadId", "==", dl.id).get();
      const expectedCash = delSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
      await ctx.reply(
        `${driverName} — ${vName}\nKutilgan pul: ${money.format(expectedCash)} so'm`,
        Markup.inlineKeyboard([[Markup.button.callback("🔒 Qabul qilib yopish", `kassir:close:${dl.id}`)]]),
      );
    }
  });

  bot.action(/^kassir:close:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft = { driverLoadId: ctx.match[1] };
    s.step = "kassir.cash";
    await ctx.answerCbQuery();
    await ctx.reply(
      "Haqiqatda qabul qilingan pulni yozing (so'm).\n\n" +
        "Eslatma: mahsulot qaytimi (vazvrat) bo'yicha farq faqat kutilganidek deb hisoblanadi — batafsil solishtirish veb-panelda.",
    );
  });

  bot.action("kassir:today", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db.collection("dayClosures").where("closedByUid", "==", s.employee.uid).where("date", "==", todayKey()).get();
    const total = snap.docs.reduce((sum, d) => sum + (d.data().receivedCash || 0), 0);
    const matchCount = snap.docs.filter((d) => d.data().status === "match").length;
    const accuracy = snap.empty ? "—" : `${Math.round((matchCount / snap.size) * 100)}%`;
    await ctx.reply(`📊 Bugun yopganingiz: *${snap.size} ta*\nQabul qilgan pul: *${money.format(total)} so'm*\nAniqligingiz: *${accuracy}*`, {
      parse_mode: "Markdown",
    });
  });

  return {
    async handleText(ctx, s, text) {
      if (s.step === "kassir.cash") {
        const receivedCash = Number(text.replace(",", "."));
        if (!Number.isFinite(receivedCash) || receivedCash < 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        const dlDoc = await db.collection("driverLoads").doc(s.draft.driverLoadId).get();
        const dl = dlDoc.data();
        const delSnap = await db.collection("deliveries").where("driverLoadId", "==", s.draft.driverLoadId).get();
        const sold = {};
        let expectedCash = 0;
        for (const d of delSnap.docs) {
          const data = d.data();
          sold[data.productId] = (sold[data.productId] || 0) + data.qtySold;
          expectedCash += data.amount;
        }
        const expectedReturns = {};
        for (const item of dl.items || []) expectedReturns[item.productId] = item.qty - (sold[item.productId] || 0);
        const matches = receivedCash === expectedCash;
        await db.collection("dayClosures").add({
          driverLoadId: s.draft.driverLoadId,
          driverUid: dl.driverUid,
          vehicleId: dl.vehicleId,
          date: todayKey(),
          expectedCash,
          expectedReturns,
          receivedCash,
          receivedReturns: expectedReturns,
          status: matches ? "match" : "mismatch",
          note: "",
          closedByUid: s.employee.uid,
          closedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(
          matches ? "✅ Yopildi — mos keldi." : `⚠️ Yopildi — farq bor (kutilgan: ${money.format(expectedCash)} so'm).`,
          mainMenuFor(s.employee.role),
        );
        return true;
      }
      return false;
    },
  };
}

module.exports = { register };
