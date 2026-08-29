const admin = require("firebase-admin");
const path = require("path");

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, "service-account.json"))),
});

async function main() {
  await admin.firestore().collection("config").doc("appVersion").set({
    latestBuild: 17,
    downloadUrl: "https://raw.githubusercontent.com/jasuribragimov305-coder/bolichka-sex-bot/main/releases/bolichka-sex.apk",
  });
  console.log("Written.");
}

main().catch((e) => { console.error(e); process.exit(1); });
