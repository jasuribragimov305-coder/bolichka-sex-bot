const { Markup } = require("telegraf");
const { db, admin } = require("../firebase");
const { getSession, resetStep } = require("../session");
const { mainMenuFor } = require("../menu");
const { todayKey, money, listProducts, listStores, vehicleLabel, grid } = require("../helpers");

async function myVehicle(uid) {
  const snap = await db
    .collection("vehicles")
    .where("assignedDriverUid", "==", uid)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function myDriverLoad(uid) {
  const snap = await db
    .collection("driverLoads")
    .where("driverUid", "==", uid)
    .where("date", "==", todayKey())
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function productName(id) {
  const doc = await db.collection("products").doc(id).get();
  return doc.exists ? doc.data().name : id;
}

async function productPrice(id) {
  const doc = await db.collection("products").doc(id).get();
  return doc.exists ? doc.data().price || 0 : 0;
}

async function storeName(id) {
  const doc = await db.collection("stores").doc(id).get();
  return doc.exists ? doc.data().name : id;
}

function dateKeyOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Zayavkani qabul qilish — mobil ilovadagi confirmWorkOrder bilan bir xil tranzaksiya. */
async function confirmWorkOrder({ workOrderId, driverUid, vehicleId, productId, qty }) {
  const date = todayKey();
  const existing = await db
    .collection("driverLoads")
    .where("driverUid", "==", driverUid)
    .where("date", "==", date)
    .limit(1)
    .get();
  const driverLoadRef = existing.empty ? db.collection("driverLoads").doc() : existing.docs[0].ref;
  const woRef = db.collection("workOrders").doc(workOrderId);

  await db.runTransaction(async (tx) => {
    const dlSnap = await tx.get(driverLoadRef);
    if (!dlSnap.exists) {
      tx.set(driverLoadRef, {
        driverUid,
        vehicleId,
        date,
        items: [{ productId, qty }],
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const items = [...(dlSnap.data().items || [])];
      const idx = items.findIndex((i) => i.productId === productId);
      if (idx >= 0) items[idx] = { productId, qty: items[idx].qty + qty };
      else items.push({ productId, qty });
      tx.update(driverLoadRef, { items });
    }
    tx.update(woRef, { status: "confirmed" });
  });
}

/** Yig'ilgan do'kon ma'lumotini Firestore'ga yozadi va sotuv oqimini
 * mahsulot tanlashga qaytaradi — mobil ilovadagi "yangi savdo nuqtasi
 * qo'shish" bilan bir xil xatti-harakat (yangi do'kon avtomatik tanlanadi). */
async function saveNewStoreAndContinue(ctx, s, location) {
  const draft = s.draft.newStore || {};
  const ref = await db.collection("stores").add({
    name: draft.name || "",
    address: draft.address || "",
    ownerName: draft.ownerName || "",
    ownerPhone: draft.ownerPhone || "",
    debt: 0,
    location,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const driverLoadId = s.draft.driverLoadId;
  s.draft = { driverLoadId, storeId: ref.id };
  s.step = null;
  await ctx.reply("✅ Do'kon qo'shildi.", Markup.removeKeyboard());
  const dl = await myDriverLoad(s.employee.uid);
  const named = await Promise.all(dl.items.map(async (i) => ({ productId: i.productId, name: await productName(i.productId) })));
  const kb = grid(named, (i) => Markup.button.callback(i.name, `sale:prod:${i.productId}`));
  await ctx.reply("Qaysi mahsulot?", Markup.inlineKeyboard(kb));
}

/** Do'kon tahrirlash oqimida yig'ilgan maydonlarni yozadi (faqat kiritilgan
 * qiymatlarni — "-" bilan o'tkazib yuborilganlar eskicha qoladi) va sotuv
 * oqimini mahsulot tanlashga qaytaradi. */
async function saveStoreEditAndContinue(ctx, s, location) {
  const edit = s.draft.editStore || {};
  const update = {};
  if (edit.name !== undefined) update.name = edit.name;
  if (edit.address !== undefined) update.address = edit.address;
  if (edit.ownerName !== undefined) update.ownerName = edit.ownerName;
  if (edit.ownerPhone !== undefined) update.ownerPhone = edit.ownerPhone;
  if (location) update.location = location;
  if (Object.keys(update).length > 0) {
    await db.collection("stores").doc(edit.id).update(update);
  }
  const driverLoadId = s.draft.driverLoadId;
  s.draft = driverLoadId ? { driverLoadId, storeId: edit.id } : {};
  s.step = null;
  await ctx.reply("✅ Do'kon ma'lumoti yangilandi.", Markup.removeKeyboard());
  if (driverLoadId) {
    const dl = await myDriverLoad(s.employee.uid);
    if (dl) {
      const named = await Promise.all(dl.items.map(async (i) => ({ productId: i.productId, name: await productName(i.productId) })));
      const kb = grid(named, (i) => Markup.button.callback(i.name, `sale:prod:${i.productId}`));
      await ctx.reply("Qaysi mahsulot?", Markup.inlineKeyboard(kb));
    }
  } else {
    await ctx.reply("Menyu:", mainMenuFor(s.employee.role));
  }
}

function register(bot) {
  // ---- bugungi mashinam ----
  bot.action("drv:vehicle", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const vehicle = await myVehicle(s.employee.uid);
    if (!vehicle) {
      await ctx.reply("Bugun sizga mashina biriktirilmagan. Admin bilan bog'laning.");
      return;
    }
    const dl = await myDriverLoad(s.employee.uid);
    if (!dl) {
      await ctx.reply(
        `🚗 Bugungi mashinangiz: *${vehicleLabel(vehicle)}*\n\nHali yuk tasdiqlanmagan. Fasovkachi/ombor tayinlagan zayavkalarni "📥 Ortilgan zayavkalar" bo'limidan qabul qiling.`,
        { parse_mode: "Markdown" },
      );
      return;
    }
    const lines = await Promise.all(
      dl.items.map(async (i) => `${await productName(i.productId)} — ${i.qty} dona`),
    );
    await ctx.reply(`🚗 *${vehicleLabel(vehicle)}* — yo'lda\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  });

  // ---- sexdan mahsulot so'rash (cex) ----
  bot.action("cex:start", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const vehicle = await myVehicle(s.employee.uid);
    if (!vehicle) {
      await ctx.reply("Bugun sizga mashina biriktirilmagan — so'rov yubora olmaysiz.");
      return;
    }
    const products = await listProducts();
    const kb = grid(products, (p) => Markup.button.callback(p.name, `cex:prod:${p.id}`));
    await ctx.reply("Sexdan qaysi mahsulotni so'raysiz?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^cex:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft = { productId: ctx.match[1] };
    s.step = "cex.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Necha dona kerak?");
  });

  // ---- ortilgan zayavkalarni qabul qilish ----
  bot.action("wo:driver", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db
      .collection("workOrders")
      .where("driverUid", "==", s.employee.uid)
      .where("date", "==", todayKey())
      .where("status", "==", "loaded")
      .get();
    if (snap.empty) {
      await ctx.reply("Hozircha qabul qilish uchun zayavka yo'q.");
      return;
    }
    for (const doc of snap.docs) {
      const w = doc.data();
      const label = `${await productName(w.productId)} — ${w.qty} dona`;
      await ctx.reply(label, Markup.inlineKeyboard([[Markup.button.callback("✅ Qabul qildim", `wo:confirm:${doc.id}`)]]));
    }
  });

  bot.action(/^wo:confirm:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const s = getSession(ctx.chat.id);
    const woDoc = await db.collection("workOrders").doc(id).get();
    if (!woDoc.exists) {
      await ctx.answerCbQuery("Topilmadi");
      return;
    }
    const w = woDoc.data();
    await confirmWorkOrder({
      workOrderId: id,
      driverUid: s.employee.uid,
      vehicleId: w.vehicleId,
      productId: w.productId,
      qty: w.qty,
    });
    await ctx.answerCbQuery("Qabul qilindi ✅");
    await ctx.editMessageReplyMarkup(null).catch(() => {});
  });

  // ---- sotuv yozish ----
  bot.action("sale:start", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const dl = await myDriverLoad(s.employee.uid);
    if (!dl) {
      await ctx.reply("Hali sizga yuk tasdiqlanmagan.");
      return;
    }
    s.draft = { driverLoadId: dl.id };
    const stores = await listStores();
    const kb = grid(stores, (st) => Markup.button.callback(st.name, `sale:store:${st.id}`));
    kb.push([Markup.button.callback("➕ Yangi do'kon qo'shish", "store:new")]);
    await ctx.reply(
      stores.length === 0 ? "Hali do'kon yo'q — yangisini qo'shing:" : "Qaysi do'konga sotdingiz?",
      Markup.inlineKeyboard(kb),
    );
  });

  // ---- yangi do'kon qo'shish (sotuv oqimi ichidan) ----
  bot.action("store:new", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    s.draft.newStore = {};
    s.step = "store.name";
    await ctx.reply("Yangi do'kon nomini yozing:");
  });

  bot.action(/^sale:store:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.storeId = ctx.match[1];
    await ctx.answerCbQuery();
    const storeDoc = await db.collection("stores").doc(s.draft.storeId).get();
    const store = storeDoc.exists ? storeDoc.data() : null;
    const loc = store ? store.location : null;
    const row = [];
    if (loc) row.push(Markup.button.url("🧭 Yo'nalish", `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`));
    row.push(Markup.button.callback("✎ Tahrirlash", "store:edit"));
    await ctx.reply(`Tanlangan do'kon: ${store ? store.name : ""}`, Markup.inlineKeyboard([row]));
    const dl = await myDriverLoad(s.employee.uid);
    const named = await Promise.all(dl.items.map(async (i) => ({ productId: i.productId, name: await productName(i.productId) })));
    const kb = grid(named, (i) => Markup.button.callback(i.name, `sale:prod:${i.productId}`));
    await ctx.reply("Qaysi mahsulot?", Markup.inlineKeyboard(kb));
  });

  // ---- tanlangan do'konni tahrirlash ----
  bot.action("store:edit", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const storeId = s.draft.storeId;
    if (!storeId) return;
    const doc = await db.collection("stores").doc(storeId).get();
    if (!doc.exists) {
      await ctx.reply("Do'kon topilmadi.");
      return;
    }
    const store = doc.data();
    s.draft.editStore = { id: storeId };
    s.step = "storeEdit.name";
    await ctx.reply(`Nomi (hozirgi: "${store.name}"). Yangisini yozing, o'zgarishsiz qoldirish uchun "-":`);
  });

  bot.action(/^sale:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.productId = ctx.match[1];
    s.step = "sale.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Nechta sotildi?");
  });

  // ---- oldindan (kelgusi kunga) zakaz olish ----
  bot.action("preorder:start", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    s.draft = {};
    const stores = await listStores();
    if (stores.length === 0) {
      await ctx.reply("Hali do'kon yo'q — avval \"Sotuv yozish\" bo'limidan do'kon qo'shing.");
      return;
    }
    const kb = grid(stores, (st) => Markup.button.callback(st.name, `preorder:store:${st.id}`));
    await ctx.reply("Qaysi do'kon zakaz berdi?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^preorder:store:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.storeId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply("Qaysi kunga kerak?", Markup.inlineKeyboard([[
      Markup.button.callback("Bugun", "preorder:date:0"),
      Markup.button.callback("Ertaga", "preorder:date:1"),
      Markup.button.callback("Indinga", "preorder:date:2"),
    ]]));
  });

  bot.action(/^preorder:date:(\d)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.deliveryDate = dateKeyOffset(Number(ctx.match[1]));
    await ctx.answerCbQuery();
    const products = await listProducts();
    const kb = grid(products, (p) => Markup.button.callback(p.name, `preorder:prod:${p.id}`));
    await ctx.reply("Qaysi mahsulot kerak?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^preorder:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.productId = ctx.match[1];
    s.step = "preorder.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Necha dona kerak?");
  });

  // ---- brak yozish ----
  bot.action("brak:start", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const dl = await myDriverLoad(s.employee.uid);
    if (!dl) {
      await ctx.reply("Hali sizga yuk tasdiqlanmagan.");
      return;
    }
    s.draft = { driverLoadId: dl.id, vehicleId: dl.vehicleId };
    const named = await Promise.all(dl.items.map(async (i) => ({ productId: i.productId, name: await productName(i.productId) })));
    const kb = grid(named, (i) => Markup.button.callback(i.name, `brak:prod:${i.productId}`));
    await ctx.reply("Qaysi mahsulot brak chiqdi?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^brak:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.productId = ctx.match[1];
    s.step = "brak.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Nechta brak?");
  });

  // ---- xarajat yozish ----
  bot.action("exp:start", async (ctx) => {
    await ctx.answerCbQuery();
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🍲 Ovqat", "exp:cat:ovqat"), Markup.button.callback("⛽ Yoqilg'i", "exp:cat:yoqilgi")],
      [Markup.button.callback("📦 Boshqa", "exp:cat:boshqa")],
    ]);
    await ctx.reply("Xarajat turi?", kb);
  });

  bot.action(/^exp:cat:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft = { category: ctx.match[1] };
    s.step = "exp.amount";
    await ctx.answerCbQuery();
    await ctx.reply("Summasi (so'm)?");
  });

  // ---- vazvrat (qaysi do'kondan, izoh bilan — rasmsiz) ----
  bot.action("ret:start", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    s.draft = {};
    const stores = await listStores();
    if (stores.length === 0) {
      await ctx.reply("Hali do'kon yo'q.");
      return;
    }
    const kb = grid(stores, (st) => Markup.button.callback(st.name, `ret:store:${st.id}`));
    await ctx.reply("Mahsulot qaysi do'kondan qaytdi?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^ret:store:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.storeId = ctx.match[1];
    await ctx.answerCbQuery();
    const products = await listProducts();
    const kb = grid(products, (p) => Markup.button.callback(p.name, `ret:prod:${p.id}`));
    await ctx.reply("Qaysi mahsulot qaytdi?", Markup.inlineKeyboard(kb));
  });

  bot.action(/^ret:prod:(.+)$/, async (ctx) => {
    const s = getSession(ctx.chat.id);
    s.draft.productId = ctx.match[1];
    s.step = "ret.qty";
    await ctx.answerCbQuery();
    await ctx.reply("Nechta qaytdi?");
  });

  bot.action("ret:mine", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const snap = await db
      .collection("returns")
      .where("driverUid", "==", s.employee.uid)
      .where("date", "==", todayKey())
      .get();
    if (snap.empty) {
      await ctx.reply("Bugun hali vazvrat yozilmagan.");
      return;
    }
    for (const doc of snap.docs) {
      const r = doc.data();
      const label = `${await productName(r.productId)} — ${r.qty} dona · ${r.storeId ? await storeName(r.storeId) : "—"}${r.note ? ` (${r.note})` : ""}`;
      await ctx.reply(label, Markup.inlineKeyboard([[Markup.button.callback("✎ Tahrirlash", `ret:edit:${doc.id}`)]]));
    }
  });

  bot.action(/^ret:edit:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const doc = await db.collection("returns").doc(id).get();
    if (!doc.exists) {
      await ctx.answerCbQuery("Topilmadi");
      return;
    }
    const r = doc.data();
    const s = getSession(ctx.chat.id);
    s.draft = { editingId: id, storeId: r.storeId, productId: r.productId };
    s.step = "ret.qty";
    await ctx.answerCbQuery();
    await ctx.reply(`Tahrirlanmoqda: ${await productName(r.productId)}. Yangi son nechta?`);
  });

  // ---- bugungi hisobot ----
  bot.action("drv:today", async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    const dl = await myDriverLoad(s.employee.uid);
    if (!dl) {
      await ctx.reply("Hali bugun yuk tasdiqlanmagan.");
      return;
    }
    const delSnap = await db.collection("deliveries").where("driverLoadId", "==", dl.id).get();
    const totalCash = delSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
    await ctx.reply(`📊 Bugun sotganingiz: *${money.format(totalCash)} so'm*`, { parse_mode: "Markdown" });
  });

  return {
    async handleText(ctx, s, text) {
      if (s.step === "cex.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        const vehicle = await myVehicle(s.employee.uid);
        await db.collection("workOrders").add({
          date: todayKey(),
          productId: s.draft.productId,
          qty,
          vehicleId: vehicle.id,
          fasovkachiUid: null,
          driverUid: s.employee.uid,
          status: "pending",
          source: "cex",
          createdByUid: s.employee.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply("✅ So'rov yuborildi — fasovkachilarga chiqdi.", mainMenuFor(s.employee.role));
        return true;
      }

      if (s.step === "store.name") {
        if (!text || text === "-") {
          await ctx.reply("Do'kon nomini kiriting:");
          return true;
        }
        s.draft.newStore.name = text;
        s.step = "store.address";
        await ctx.reply("Mo'ljal / manzil yozing (bo'lmasa \"-\"):");
        return true;
      }
      if (s.step === "store.address") {
        s.draft.newStore.address = text === "-" ? "" : text;
        s.step = "store.owner_name";
        await ctx.reply("Magazinchi ismi (bo'lmasa \"-\"):");
        return true;
      }
      if (s.step === "store.owner_name") {
        s.draft.newStore.ownerName = text === "-" ? "" : text;
        s.step = "store.owner_phone";
        await ctx.reply("Magazinchi raqami (bo'lmasa \"-\"):");
        return true;
      }
      if (s.step === "store.owner_phone") {
        s.draft.newStore.ownerPhone = text === "-" ? "" : text;
        s.step = "store.location";
        await ctx.reply(
          "Endi do'kon joylashuvini yuboring — pastdagi tugmani bosing. Joylashuvsiz davom etish uchun \"-\" deb yozing.",
          Markup.keyboard([[Markup.button.locationRequest("📍 Joylashuvni yuborish")]]).resize().oneTime(),
        );
        return true;
      }
      if (s.step === "store.location") {
        if (text === "-") {
          await saveNewStoreAndContinue(ctx, s, null);
        } else {
          await ctx.reply("Iltimos, \"📍 Joylashuvni yuborish\" tugmasini bosing yoki \"-\" deb yozing.");
        }
        return true;
      }

      if (s.step === "storeEdit.name") {
        if (text !== "-") s.draft.editStore.name = text;
        s.step = "storeEdit.address";
        await ctx.reply("Mo'ljal/manzil — yangisini yozing, o'zgarishsiz qoldirish uchun \"-\":");
        return true;
      }
      if (s.step === "storeEdit.address") {
        if (text !== "-") s.draft.editStore.address = text;
        s.step = "storeEdit.owner_name";
        await ctx.reply("Magazinchi ismi — yangisini yozing, o'zgarishsiz qoldirish uchun \"-\":");
        return true;
      }
      if (s.step === "storeEdit.owner_name") {
        if (text !== "-") s.draft.editStore.ownerName = text;
        s.step = "storeEdit.owner_phone";
        await ctx.reply("Magazinchi raqami — yangisini yozing, o'zgarishsiz qoldirish uchun \"-\":");
        return true;
      }
      if (s.step === "storeEdit.owner_phone") {
        if (text !== "-") s.draft.editStore.ownerPhone = text;
        s.step = "storeEdit.location";
        await ctx.reply(
          "Joylashuvni yangilamoqchimisiz? Pastdagi tugma bilan yuboring, o'zgarishsiz qoldirish uchun \"-\" deb yozing.",
          Markup.keyboard([[Markup.button.locationRequest("📍 Joylashuvni yuborish")]]).resize().oneTime(),
        );
        return true;
      }
      if (s.step === "storeEdit.location") {
        if (text === "-") {
          await saveStoreEditAndContinue(ctx, s, null);
        } else {
          await ctx.reply("Iltimos, \"📍 Joylashuvni yuborish\" tugmasini bosing yoki \"-\" deb yozing.");
        }
        return true;
      }

      if (s.step === "preorder.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        s.draft.qty = qty;
        s.step = "preorder.note";
        await ctx.reply("Izoh yozing (bo'lmasa \"-\"):");
        return true;
      }
      if (s.step === "preorder.note") {
        await db.collection("preorders").add({
          driverUid: s.employee.uid,
          storeId: s.draft.storeId,
          productId: s.draft.productId,
          qty: s.draft.qty,
          deliveryDate: s.draft.deliveryDate,
          note: text === "-" ? "" : text,
          status: "pending",
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply("✅ Zakaz qayd etildi.", mainMenuFor(s.employee.role));
        return true;
      }

      if (s.step === "sale.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        const dl = await myDriverLoad(s.employee.uid);
        const item = dl.items.find((i) => i.productId === s.draft.productId);
        const sold = (
          await db
            .collection("deliveries")
            .where("driverLoadId", "==", dl.id)
            .where("productId", "==", s.draft.productId)
            .get()
        ).docs.reduce((sum, d) => sum + (d.data().qtySold || 0), 0);
        const remaining = (item ? item.qty : 0) - sold;
        if (qty > remaining) {
          await ctx.reply(`Mashinada faqat ${remaining} dona qoldi. Qaytadan kiriting:`);
          return true;
        }
        const price = await productPrice(s.draft.productId);
        await db.collection("deliveries").add({
          driverLoadId: dl.id,
          driverUid: s.employee.uid,
          storeId: s.draft.storeId,
          productId: s.draft.productId,
          qtySold: qty,
          amount: qty * price,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Sotuv yozildi: ${qty} dona, ${money.format(qty * price)} so'm`, mainMenuFor(s.employee.role));
        return true;
      }

      if (s.step === "brak.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        s.draft.qty = qty;
        s.step = "brak.note";
        await ctx.reply("Izoh yozing (bo'lmasa \"-\" deb yozing):");
        return true;
      }
      if (s.step === "brak.note") {
        await db.collection("brakLogs").add({
          driverUid: s.employee.uid,
          driverLoadId: s.draft.driverLoadId,
          vehicleId: s.draft.vehicleId,
          productId: s.draft.productId,
          qty: s.draft.qty,
          note: text === "-" ? "" : text,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply("✅ Brak qayd etildi.", mainMenuFor(s.employee.role));
        return true;
      }

      if (s.step === "exp.amount") {
        const amount = Number(text.replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        s.draft.amount = amount;
        s.step = "exp.note";
        await ctx.reply("Izoh yozing (bo'lmasa \"-\" deb yozing):");
        return true;
      }
      if (s.step === "exp.note") {
        await db.collection("expenses").add({
          driverUid: s.employee.uid,
          category: s.draft.category,
          amount: s.draft.amount,
          note: text === "-" ? "" : text,
          date: todayKey(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Xarajat qayd etildi: ${money.format(s.draft.amount)} so'm`, mainMenuFor(s.employee.role));
        return true;
      }

      if (s.step === "ret.qty") {
        const qty = Number(text.replace(",", "."));
        if (!Number.isFinite(qty) || qty <= 0) {
          await ctx.reply("To'g'ri son kiriting.");
          return true;
        }
        s.draft.qty = qty;
        s.step = "ret.note";
        await ctx.reply("Izoh yozing (masalan: srogi o'tgan; bo'lmasa \"-\"):");
        return true;
      }
      if (s.step === "ret.note") {
        const note = text === "-" ? "" : text;
        if (s.draft.editingId) {
          await db.collection("returns").doc(s.draft.editingId).update({
            storeId: s.draft.storeId,
            productId: s.draft.productId,
            qty: s.draft.qty,
            note,
          });
        } else {
          await db.collection("returns").add({
            driverUid: s.employee.uid,
            storeId: s.draft.storeId,
            productId: s.draft.productId,
            qty: s.draft.qty,
            note,
            date: todayKey(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        resetStep(ctx.chat.id);
        await ctx.reply("✅ Vazvrat qayd etildi.", mainMenuFor(s.employee.role));
        return true;
      }

      return false;
    },

    async handleLocation(ctx, s) {
      const { latitude, longitude } = ctx.message.location;
      if (s.step === "store.location" && s.draft.newStore) {
        await saveNewStoreAndContinue(ctx, s, { lat: latitude, lng: longitude });
        return true;
      }
      if (s.step === "storeEdit.location" && s.draft.editStore) {
        await saveStoreEditAndContinue(ctx, s, { lat: latitude, lng: longitude });
        return true;
      }
      return false;
    },
  };
}

module.exports = { register };
