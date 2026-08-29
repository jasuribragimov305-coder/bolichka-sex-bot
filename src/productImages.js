const fs = require("fs");
const path = require("path");
const { db, auth } = require("./firebase");
const { commitAndPush } = require("./pushToGithub");

const REPO_OWNER = "jasuribragimov305-coder";
const REPO_NAME = "bolichka-sex-bot";
const IMAGES_DIR = path.resolve(__dirname, "..", "product-images");
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Admin saytidan kelgan Firebase ID token haqiqatan admin xodimga
 * tegishligini tekshiradi — aks holda istalgan odam bu endpoint'ga
 * to'g'ridan-to'g'ri so'rov yuborib, botning GitHub push huquqidan
 * suiiste'mol qilishi mumkin edi. */
async function verifyAdmin(idToken) {
  const decoded = await auth.verifyIdToken(idToken);
  const empDoc = await db.collection("employees").doc(decoded.uid).get();
  if (!empDoc.exists || empDoc.data().role !== "admin") {
    throw new Error("Faqat admin rasm yuklay oladi");
  }
}

/** Mahsulot rasmini GitHub repo'ga (Firebase Storage/Blaze rejasi shart
 * bo'lmasin deb) commit+push qilib, ochiq raw.githubusercontent.com
 * havolasini qaytaradi. */
async function uploadProductImage({ idToken, filename, contentBase64 }) {
  await verifyAdmin(idToken);

  const ext = (path.extname(filename || "") || ".jpg").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error("Faqat jpg/png/webp rasm qabul qilinadi");

  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.length > MAX_BYTES) throw new Error("Rasm 2MB dan katta bo'lmasin");

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, safeName), buffer);

  await commitAndPush(`Mahsulot rasmi qo'shildi: ${safeName}`);

  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/product-images/${safeName}`;
}

module.exports = { uploadProductImage };
