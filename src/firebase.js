const path = require("path");
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "demo-bolichka-sex";
const useEmulator = process.env.USE_EMULATOR !== "false";

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  admin.initializeApp({ projectId });
} else if (process.env.K_SERVICE) {
  // Cloud Run'ning o'zida ishlayapmiz — instance'ga biriktirilgan xizmat
  // hisobi orqali avtomatik ishonch bilan ulanadi, alohida kalit fayli
  // konteynerga qo'shilishi shart emas (xavfsizroq).
  admin.initializeApp({ projectId });
} else {
  // Mahalliy kompyuterdan haqiqiy loyihaga ulanish uchun Admin SDK'ga
  // xizmat hisobi kaliti kerak. .env'dagi nisbiy yo'l bot papkasiga
  // (process.cwd()) nisbatan hisoblanadi, src/ ga emas.
  const keyPathRaw = process.env.GOOGLE_APPLICATION_CREDENTIALS || "./service-account.json";
  const keyPath = path.isAbsolute(keyPathRaw) ? keyPathRaw : path.resolve(process.cwd(), keyPathRaw);
  admin.initializeApp({
    projectId,
    credential: admin.credential.cert(require(keyPath)),
  });
}

const db = admin.firestore();
const auth = admin.auth();

/**
 * Login+parolni tekshiradi. Admin SDK parolni o'zi tekshira olmaydi (u shunday
 * mo'ljallangan) — shuning uchun Identity Toolkit REST orqali haqiqiy
 * signInWithPassword chaqiramiz, xuddi mobil/veb ilova qiladigandek.
 * Muvaffaqiyatli bo'lsa Firebase uid qaytaradi, aks holda null.
 */
async function verifyLogin(login, password) {
  const email = `${login.trim()}@bolichka.local`;
  const host = useEmulator
    ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`
    : "https://identitytoolkit.googleapis.com/v1";
  const apiKey = useEmulator ? "fake-api-key" : process.env.FIREBASE_WEB_API_KEY;
  const resp = await fetch(`${host}/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.localId || null;
}

async function getEmployee(uid) {
  const doc = await db.collection("employees").doc(uid).get();
  if (!doc.exists) return null;
  return { uid, ...doc.data() };
}

module.exports = { admin, db, auth, verifyLogin, getEmployee };
