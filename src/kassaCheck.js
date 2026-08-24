const { db } = require("./firebase");
const { todayKey } = require("./helpers");

async function findChatIdForUid(uid) {
  const snap = await db.collection("botSessions").where("employee.uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

/** Shu kunga oid `attendance` hujjatida admin qo'lda "manual" deb belgilagan
 * qiymat bo'lsa, o'shani ustun qo'yamiz — aks holda dayClosures'ning
 * borligiga qarab avtomatik hisoblaymiz. */
async function computeStatus(date) {
  const [driverLoadsSnap, closuresSnap, overridesSnap, employeesSnap] = await Promise.all([
    db.collection("driverLoads").where("date", "==", date).get(),
    db.collection("dayClosures").where("date", "==", date).get(),
    db.collection("attendance").where("date", "==", date).get(),
    db.collection("employees").get(),
  ]);

  const driverLoadIdByUid = new Map(driverLoadsSnap.docs.map((d) => [d.data().driverUid, d.id]));
  const closedDriverLoadIds = new Set(closuresSnap.docs.map((d) => d.data().driverLoadId));
  const overrideByUid = new Map(overridesSnap.docs.map((d) => [d.data().driverUid, d.data()]));
  const nameByUid = new Map(employeesSnap.docs.map((d) => [d.id, d.data().name]));

  const came = [];
  const missing = [];
  for (const [uid, driverLoadId] of driverLoadIdByUid) {
    const override = overrideByUid.get(uid);
    const present = override ? override.present : closedDriverLoadIds.has(driverLoadId);
    (present ? came : missing).push(uid);
  }
  return { came, missing, nameByUid };
}

/** Har kuni kechqurun (GitHub Actions cron orqali) chaqiriladi: hali kassaga
 * kelmagan sotuvchilarga shaxsiy eslatma, adminlarga esa umumiy hisobot
 * yuboradi. Faqat botga hech bo'lmasa bir marta kirgan xodimlarga yetadi —
 * chatId shundagina ma'lum bo'ladi. */
async function runKassaCheck(bot) {
  const date = todayKey();
  const { came, missing, nameByUid } = await computeStatus(date);

  for (const uid of missing) {
    const chatId = await findChatIdForUid(uid);
    if (!chatId) continue;
    await bot.telegram
      .sendMessage(chatId, "⏰ Bugun hali kassaga (kunni yopishga) kelmadingiz. Iltimos, tez orada boring.")
      .catch(() => {});
  }

  const employeesSnap = await db.collection("employees").where("role", "==", "admin").get();
  if (came.length === 0 && missing.length === 0) return;
  const summary = [
    `📋 Kunlik kassa nazorati (${date})`,
    "",
    `✅ Keldi: ${came.map((u) => nameByUid.get(u) || u).join(", ") || "—"}`,
    `❌ Kelmadi: ${missing.map((u) => nameByUid.get(u) || u).join(", ") || "—"}`,
  ].join("\n");
  for (const doc of employeesSnap.docs) {
    const chatId = await findChatIdForUid(doc.id);
    if (!chatId) continue;
    await bot.telegram.sendMessage(chatId, summary).catch(() => {});
  }
}

module.exports = { runKassaCheck };
