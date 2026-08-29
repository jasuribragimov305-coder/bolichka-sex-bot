const git = require("isomorphic-git");
const fs = require("fs");
const path = require("path");

// `bot/` papkasining o'zi git working tree — repo ildizi shu yerda joylashgan
// (releases/bolichka-sex.apk ham shu papka ostida). `_push_to_github.js`
// bilan bir xil mantiq, faqat qayta ishlatish uchun funksiya sifatida.
const dir = path.resolve(__dirname, "..");

// isomorphic-git/http/node (simple-get)ning ichki timeout'i katta fayl
// (masalan APK) yuklashda uzilib qolgani uchun — Node'ning o'z global
// fetch()'iga asoslangan moslashtirilgan http klient.
const httpClient = {
  async request({ url, method = "GET", headers = {}, body }) {
    let reqBody;
    if (body) {
      const chunks = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      reqBody = Buffer.concat(chunks);
    }
    const res = await fetch(url, { method, headers, body: reqBody });
    const headersObj = {};
    res.headers.forEach((v, k) => { headersObj[k] = v; });
    return {
      url: res.url,
      method,
      statusCode: res.status,
      statusMessage: res.statusText,
      headers: headersObj,
      body: res.body,
    };
  },
};

/** Ishchi papkadagi barcha o'zgarishlarni commit qilib GitHub'ga push qiladi.
 * `process.env.GH_PAT` kerak (Render'da doimiy environment variable
 * sifatida sozlangan bo'lishi kerak). O'zgarish bo'lmasa `false` qaytaradi. */
async function commitAndPush(message) {
  const token = process.env.GH_PAT;
  if (!token) throw new Error("GH_PAT environment variable sozlanmagan");
  await git.add({ fs, dir, filepath: "." });
  const status = await git.statusMatrix({ fs, dir });
  const changed = status.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
  if (!changed) return false;
  await git.commit({
    fs, dir, message,
    author: { name: "Bolichka bot", email: "jasuribragimov305@gmail.com" },
  });
  await git.push({
    fs, http: httpClient, dir,
    remote: "origin", ref: "main",
    onAuth: () => ({ username: token }),
  });
  return true;
}

module.exports = { commitAndPush };
