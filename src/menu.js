const { Markup } = require("telegraf");

const roleLabels = {
  admin: "Admin",
  pichuvchi: "Pichuvchi",
  fasovkachi: "Fasovkachi",
  haydovchi: "Sotuvchi",
  kassir: "Kassir",
};

function mainMenuFor(role) {
  const rows = [];
  if (role === "pichuvchi") {
    rows.push([Markup.button.callback("✂️ Kesish yozish", "cut:start")]);
    rows.push([Markup.button.callback("📊 Bugungi natijam", "cut:today")]);
  } else if (role === "fasovkachi") {
    rows.push([Markup.button.callback("📦 Fasovka yozish", "pack:start")]);
    rows.push([Markup.button.callback("🚚 Yuklash yozish", "load:start")]);
    rows.push([Markup.button.callback("📋 Menga tayinlangan zayavkalar", "wo:mine")]);
    rows.push([Markup.button.callback("🏭 Sotuvchilar so'rovlari", "wo:pool")]);
    rows.push([Markup.button.callback("🔴 Menga tayinlangan zakazlar", "preorder:mine")]);
    rows.push([Markup.button.callback("🗓 Ochiq zakazlar", "preorder:pool")]);
    rows.push([Markup.button.callback("📊 Bugungi natijam", "pack:today")]);
  } else if (role === "haydovchi") {
    rows.push([Markup.button.callback("🚗 Bugungi mashinam", "drv:vehicle")]);
    rows.push([Markup.button.callback("🏭 Sexdan mahsulot so'rash", "cex:start")]);
    rows.push([Markup.button.callback("📥 Ortilgan zayavkalar", "wo:driver")]);
    rows.push([Markup.button.callback("🛒 Sotuv yozish", "sale:start")]);
    rows.push([Markup.button.callback("📝 Oldindan zakaz olish", "preorder:start")]);
    rows.push([Markup.button.callback("🗑 Brak yozish", "brak:start")]);
    rows.push([Markup.button.callback("💸 Xarajat yozish", "exp:start")]);
    rows.push([Markup.button.callback("↩️ Vazvrat (qaytgan mahsulot)", "ret:start")]);
    rows.push([Markup.button.callback("📝 Bugungi vazvratlarim", "ret:mine")]);
    rows.push([Markup.button.callback("📊 Bugungi hisobotim", "drv:today")]);
  } else if (role === "kassir") {
    rows.push([Markup.button.callback("📋 Bugungi yuklar", "kassir:loads")]);
    rows.push([Markup.button.callback("📊 Mening natijam", "kassir:today")]);
  } else if (role === "admin") {
    rows.push([Markup.button.callback("📊 Bugungi hisobot", "admin:summary")]);
  }
  rows.push([Markup.button.callback("🚪 Chiqish", "logout")]);
  return Markup.inlineKeyboard(rows);
}

function welcomeText(employee) {
  return `Salom, *${employee.name}*!\nLavozim: ${roleLabels[employee.role] || employee.role}\n\nKerakli amalni tanlang:`;
}

module.exports = { roleLabels, mainMenuFor, welcomeText };
