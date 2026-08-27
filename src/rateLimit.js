// Render'ning bepul tarifida tashqi himoya devori (WAF)/tezlik cheklovi
// yo'q — shuning uchun eng oddiy hujumlarga (bitta manbadan ko'p so'rov
// yuborish) qarshi o'zimiz kichik, xotiradagi cheklov qo'yamiz. Murakkab
// tarqalgan hujumlarga (DDoS) bu yordam bermaydi — undan Render/Cloudflare
// kabi platforma darajasida himoyalanadi, lekin oddiy skript-hujumlarni
// yoki xato bilan takrorlanayotgan so'rovlarni to'xtatadi.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const hits = new Map(); // ip -> [timestamp, timestamp, ...]

function isRateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  // Xotira o'sib ketmasligi uchun vaqti-vaqti bilan eski yozuvlarni tozalaymiz.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return list.length > MAX_PER_WINDOW;
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

/** Doim bir xil uzunlikda solishtiradi — vaqt farqidan sirni "topib olish"
 * (timing attack) imkoniyatini yo'qotadi. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { isRateLimited, clientIp, safeEqual };
