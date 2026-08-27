const { verifyLogin, getEmployee } = require("../firebase");
const { getSession, resetStep } = require("../session");
const { mainMenuFor, welcomeText } = require("../menu");

function register(bot) {
  bot.start(async (ctx) => {
    const s = getSession(ctx.chat.id);
    if (s.employee) {
      await ctx.reply(welcomeText(s.employee), { parse_mode: "Markdown", ...mainMenuFor(s.employee.role) });
      return;
    }
    s.step = "login.username";
    await ctx.reply(
      "🥐 *Bolichka* — xodim boti\n\nAdmin sizga bergan login va parolingiz bilan kiring.\n\nLoginni yozing:",
      { parse_mode: "Markdown" },
    );
  });

  bot.action("logout", async (ctx) => {
    getSession(ctx.chat.id).employee = null;
    resetStep(ctx.chat.id);
    await ctx.answerCbQuery();
    await ctx.reply("Tizimdan chiqdingiz. Qayta kirish uchun /start ni bosing.");
  });

  bot.command("menu", async (ctx) => {
    const s = getSession(ctx.chat.id);
    if (!s.employee) {
      await ctx.reply("Avval tizimga kiring: /start");
      return;
    }
    resetStep(ctx.chat.id);
    await ctx.reply(welcomeText(s.employee), { parse_mode: "Markdown", ...mainMenuFor(s.employee.role) });
  });

  return {
    async handleText(ctx, s, text) {
      if (s.step === "login.username") {
        s.draft.login = text.trim();
        s.step = "login.password";
        await ctx.reply("Parolni yozing:");
        return true;
      }
      if (s.step === "login.password") {
        const login = s.draft.login;
        const uid = await verifyLogin(login, text.trim());
        if (!uid) {
          s.step = "login.username";
          s.draft = {};
          await ctx.reply("❌ Login yoki parol xato. Qaytadan urinib ko'ring.\n\nLoginni yozing:");
          return true;
        }
        const emp = await getEmployee(uid);
        if (!emp || emp.active === false) {
          s.step = "login.username";
          s.draft = {};
          await ctx.reply("❌ Bu hisob faol emas. Admin bilan bog'laning.\n\nLoginni yozing:");
          return true;
        }
        s.employee = emp;
        resetStep(ctx.chat.id);
        await ctx.reply(`✅ Xush kelibsiz, ${emp.name}!`);
        await ctx.reply(welcomeText(emp), { parse_mode: "Markdown", ...mainMenuFor(emp.role) });
        return true;
      }
      return false;
    },
  };
}

module.exports = { register };
