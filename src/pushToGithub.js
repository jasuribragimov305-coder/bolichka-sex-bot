const git = require("isomorphic-git");
const fs = require("fs");
const path = require("path");

// `bot/` papkasining o'zi git working tree — repo ildizi shu yerda joylashgan
// (releases/bolichka-sex.apk ham shu papka ostida). `_push_to_github.js`
// bilan bir xil mantiq, faqat qayta ishlatish uchun funksiya sifatida.
const dir = path.resolve(__dirname, "..");

// Render'ning deploy jarayoni repo'ni oddiy "git clone origin ..." dan
// boshqacha usulda tortadi — natijada .git/config'da remote.origin.url
// bo'lmasligi (yoki HEAD "main" branch'iga bog'lanmagan/detached bo'lishi)
// mumkin. Shuning uchun remote nomiga tayanmasdan to'g'ridan-to'g'ri URL
// beramiz, va commit/push'ni aniq "main" branch'iga qarab bajaramiz.
const REPO_URL = "https://github.com/jasuribragimov305-coder/bolichka-sex-bot.git";
const BRANCH = "main";

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

/** Berilgan fayl(lar)ni (yoki hammasini, agar berilmasa) commit qilib
 * GitHub'ga push qiladi. `process.env.GH_PAT` kerak (Render'da doimiy
 * environment variable sifatida sozlangan bo'lishi kerak).
 * `filepaths` berilsa faqat o'sha fayllar `git add` qilinadi — butun
 * repo (katta APK bilan birga) qayta skanerlanmaydi, tezroq ishlaydi. */
async function commitAndPush(message, filepaths) {
  const token = process.env.GH_PAT;
  if (!token) throw new Error("GH_PAT environment variable sozlanmagan");

  for (const fp of filepaths ?? ["."]) {
    await git.add({ fs, dir, filepath: fp });
  }
  const status = await git.statusMatrix({ fs, dir, filepaths: filepaths ?? undefined });
  const changed = status.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
  if (changed) {
    // `ref: BRANCH` — HEAD qaysi holatda bo'lishidan qat'iy nazar (detached
    // bo'lsa ham) commit aniq "refs/heads/main"ga yoziladi.
    await git.commit({
      fs, dir, message, ref: BRANCH,
      author: { name: "Bolichka bot", email: "jasuribragimov305@gmail.com" },
    });
  }
  // Har doim push qilamiz (nafaqat "changed" bo'lganda) — oldingi urinishda
  // commit muvaffaqiyatli bo'lib, faqat push muvaffaqiyatsiz bo'lgan bo'lsa,
  // shu commit push qilinmay qolib ketmasin.
  try {
    await git.push({
      fs, http: httpClient, dir,
      url: REPO_URL, ref: BRANCH, remoteRef: BRANCH,
      onAuth: () => ({ username: token }),
    });
  } catch (err) {
    console.error("GitHub'ga push qilishda xatolik:", err);
    throw new Error(`GitHub push xatoligi: ${err.message || err}`);
  }
  return changed;
}

module.exports = { commitAndPush };
