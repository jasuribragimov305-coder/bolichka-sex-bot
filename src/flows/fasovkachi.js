const { Markup } = require("telegraf");
const { db, admin } = require("../firebase");
const { getSession, resetStep } = require("../session");
const { mainMenuFor } = require("../menu");
const { todayKey, listProducts, listVehicles, vehicleLabel, grid } = require("../helpers");

function register(bot) {
  // ---- fasovka (packLogs) ----
  bot.action("pack:start", async (ctx) => {
    await ctx.answerCbQuery();
    const products = await listProducts();
    const kb = grid(products, (p) => Markup.button.callback(p.name, `pack:prod:${p.id}`));
    await ctx.reply("Qaysi mahsulotni fasovka qildingiz?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^pack:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft = { productId: ctx.match[1] };
    await ctx.answerCbQuery();
    const vehicles = await listVehicles();
    const kb = grid(vehicles, (v) => Markup.button.callback(vehicleLabel(v), `pack:veh:${v.id}`));
    await ctx.reply("Qaysi mashinaga?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^pack:veh:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.vehicleId = ctx.match[1];
    s.step = "pack.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Necha dona?");
  });

  bot.action("pack:today", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db
      .collection("packLogs")
      .where("employeeUid", "==", s.employee.uid)
      .where("date", "==", todayKey())
      .get();
    const total = snap.docs.reduce((sum, d) => sum + (d.data().qty || 0), 0);
    await ctx.reply(`📊 Bugun fasovka qilganingiz: *${total} dona* (${snap.size} ta yozuv)`, { parse_mode: "Markdown" });
  });

  // ---- mashinaga yuklash (loadLogs) ----
  bot.action("load:start", async (ctx) => {
    await ctx.answerCbQuery();
    const vehicles = await listVehicles();
    const kb = grid(vehicles, (v) => Markup.button.callback(vehicleLabel(v), `load:veh:${v.id}`));
    await ctx.reply("Qaysi mashinaga yukladingiz?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^load:veh:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft = { vehicleId: ctx.match[1] };
    await ctx.answerCbQuery();
    const products = await listProducts();
    const kb = grid(products, (p) => Markup.button.callback(p.name, `load:prod:${p.id}`));
    await ctx.reply("Qaysi mahsulot?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^load:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.productId = ctx.match[1];
    s.step = "load.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Necha dona?");
  });

  // ---- admin/sotuvchi zayavkalari ----
  async function productName(id) {
    const doc = await db.collection("products").doc(id).get();
    return doc.exists ? doc.data().name : id;
  }
  async function vehicleName(id) {
    const doc = await db.collection("vehicles").doc(id).get();
    return doc.exists ? vehicleLabel({ id, ...doc.data() }) : id;
  }

  bot.action("wo:mine", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db
      .collection("workOrders")
      .where("fasovkachiUid", "==", s.employee.uid)
      .where("date", "==", todayKey())
      .where("status", "==", "pending")
      .get();
    if (snap.empty) {
      await ctx.reply("Sizga hozircha tayinlangan zayavka yo'q.");
      return;
    }
    for (const doc of snap.docs) {
      const w = doc.data();
      const label = `${await productName(w.productId)} — ${w.qty} dona → ${await vehicleName(w.vehicleId)}`;
      await ctx.reply(label, Markup.inlineKeyboard([[Markup.button.callback("✅ Ortildi", `wo:load:${doc.id}`)]]));
    }
  });

  bot.action("wo:pool", async (ctx) => {
    await ctx.answerCbQuery();
    const snap = await db
      .collection("workOrders")
      .where("source", "==", "cex")
      .where("date", "==", todayKey())
      .where("status", "==", "pending")
      .get();
    if (snap.empty) {
      await ctx.reply("Hozircha sotuvchilardan so'rov yo'q.");
      return;
    }
    for (const doc of snap.docs) {
      const w = doc.data();
      const label = `${await productName(w.productId)} — ${w.qty} dona → ${await vehicleName(w.vehicleId)}`;
      await ctx.reply(label, Markup.inlineKeyboard([[Markup.button.callback("🙋 Men olaman", `wo:claim:${doc.id}`)]]));
    }
  });

  bot.action(/^wo:load:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.collection("workOrders").doc(id).update({ status: "loaded" });
    await ctx.answerCbQuery("Ortildi deb belgilandi ✅");
    await ctx.editMessageReplyMarkup(null).catch(() => {});
  });

  bot.action(/^wo:claim:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const s = getSession(ctx.chat.id);
    await db.collection("workOrders").doc(id).update({ status: "loaded", fasovkachiUid: s.employee.uid });
    await ctx.answerCbQuery("Band qilindi va ortildi ✅");
    await ctx.editMessageReplyMarkup(null).catch(() => {});
  });

  // ---- kelgusi zakazlar (sotuvchilar oldindan olgan) ----
  async function storeName(id) {
    const doc = await db.collection("stores").doc(id).get();
    return doc.exists ? doc.data().name : id;
  }

  async function listPreorders(ctx, snap, emptyText) {
    if (snap.empty) {
      await ctx.reply(emptyText);
      return;
    }
    const docs = snap.docs.sort((a, b) => (a.data().deliveryDate || "").localeCompare(b.data().deliveryDate || ""));
    for (const doc of docs) {
      const p = doc.data();
      const label = `${p.deliveryDate} · ${await storeName(p.storeId)}\n${await productName(p.productId)} — ${p.qty} dona${p.note ? `\n${p.note}` : ""}`;
      await ctx.reply(label, Markup.inlineKeyboard([[Markup.button.callback("✅ Tayyor", `preorder:done:${doc.id}`)]]));
    }
  }

  bot.action("preorder:mine", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db.collection("preorders")
      .where("status", "==", "pending")
      .where("assignedFasovkachiUid", "==", s.employee.uid)
      .get();
    await listPreorders(ctx, snap, "Sizga majburiy tayinlangan zakaz yo'q.");
  });

  bot.action("preorder:pool", async (ctx) => {
    await ctx.answerCbQuery();
    const snap = await db.collection("preorders")
      .where("status", "==", "pending")
      .where("assignedFasovkachiUid", "==", null)
      .get();
    await listPreorders(ctx, snap, "Hozircha ochiq zakaz yo'q.");
  });

  bot.action(/^preorder:done:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    await db.collection("preorders").doc(id).update({ status: "done" });
    await ctx.answerCbQuery("Tayyor deb belgilandi ✅");
    await ctx.editMessageReplyMarkup(null).catch(() => {});
  });

  return {
    async handleText(ctx, s, text) {
      if (s.step === "pack.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting (masalan: 200).");
          return true;
        }
        await db.collection("packLogs").add({
          employeeUid: s.employee.uid,
          employeeName: s.employee.name,
          productId: s.draft.productId,
          qty,
          vehicleId: s.draft.vehicleId,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Qo'shildi: ${qty} dona`, mainMenuFor(s.employee.role));
        return true;
      }
      if (s.step === "load.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting (masalan: 200).");
          return true;
        }
        await db.collection("loadLogs").add({
          employeeUid: s.employee.uid,
          employeeName: s.employee.name,
          productId: s.draft.productId,
          qty,
          vehicleId: s.draft.vehicleId,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Qo'shildi: ${qty} dona`, mainMenuFor(s.employee.role));
        return true;
      }
      return false;
    },
  };
}

module.exports = { register };
