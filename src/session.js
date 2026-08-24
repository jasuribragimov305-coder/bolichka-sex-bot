// Har bir Telegram chat uchun xotiradagi holat — tezkor sinxron
// getSession()/resetStep()/logout() barcha oqim fayllarida o'zgarishsiz
// ishlatiladi. Cloud Run kabi "so'rov kelganda ishga tushadigan" (scale to
// zero) muhitda instance har doim xotirada saqlanib turmaydi — shuning
// uchun index.js'dagi middleware har bir yangilanishdan OLDIN Firestore'dan
// shu chat'ning holatini xotiraga yuklaydi, KEYIN esa qayta yozib qo'yadi.
// Bu ikkalasi ham shu faylda, qolgan hamma joyda hech narsa o'zgarmaydi.
const { db } = require("./firebase");

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { employee: null, step: null, draft: {} });
  return sessions.get(chatId);
}

function resetStep(chatId) {
  const s = getSession(chatId);
  s.step = null;
  s.draft = {};
}

function logout(chatId) {
  sessions.delete(chatId);
  // Firestore'dagi nusxani ham o'chiramiz — aks holda keyingi sovuq
  // boshlanishda eski (kirgan) holat qayta yuklanib qoladi.
  db.collection("botSessions").doc(String(chatId)).delete().catch(() => {});
}

async function loadSessionFromFirestore(chatId) {
  if (sessions.has(chatId)) return; // shu instance xotirasida allaqachon bor
  try {
    const doc = await db.collection("botSessions").doc(String(chatId)).get();
    if (doc.exists) sessions.set(chatId, doc.data());
  } catch (err) {
    console.error("Sessiyani yuklashda xatolik:", err);
  }
}

async function saveSessionToFirestore(chatId) {
  const s = sessions.get(chatId);
  if (!s) return;
  try {
    await db.collection("botSessions").doc(String(chatId)).set(s);
  } catch (err) {
    console.error("Sessiyani saqlashda xatolik:", err);
  }
}

module.exports = { getSession, resetStep, logout, loadSessionFromFirestore, saveSessionToFirestore };
