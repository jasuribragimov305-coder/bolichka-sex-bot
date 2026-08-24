const { db } = require("../firebase");
const { todayKey, money } = require("../helpers");

/** SkladTab/CexTab'dagi bilan bir xil "kelgan − chiqarilgan" formulasi. */
async function stockValue(receiptsCollection, hasCost, sourceFilter) {
  const [receiptsSnap, ordersSnap] = await Promise.all([
    db.collection(receiptsCollection).get(),
    db.collection("workOrders").get(),
  ]);
  const dispatched = new Map();
  for (const doc of ordersSnap.docs) {
    const w = doc.data();
    if ((w.source || "sklad") !== sourceFilter) continue;
    if (w.status === "loaded" || w.status === "confirmed") {
      dispatched.set(w.productId, (dispatched.get(w.productId) || 0) + w.qty);
    }
  }
  const received = new Map();
  for (const doc of receiptsSnap.docs) {
    const r = doc.data();
    const e = received.get(r.productId) || { qty: 0, costSum: 0 };
    e.qty += r.qty;
    if (hasCost) e.costSum += r.qty * r.costPrice;
    received.set(r.productId, e);
  }
  let totalValue = 0;
  let totalRemaining = 0;
  for (const [productId, v] of received.entries()) {
    const remaining = Math.max(0, v.qty - (dispatched.get(productId) || 0));
    totalRemaining += remaining;
    if (hasCost) totalValue += remaining * (v.qty > 0 ? v.costSum / v.qty : 0);
  }
  return { totalValue, totalRemaining };
}

function register(bot) {
  bot.action("admin:summary", async (ctx) => {
    await ctx.answerCbQuery();
    const today = todayKey();

    const [deliveriesSnap, expensesSnap, employeesSnap, workOrdersSnap, sklad, cex] = await Promise.all([
      db.collection("deliveries").where("date", "==", today).get(),
      db.collection("expenses").where("date", "==", today).get(),
      db.collection("employees").get(),
      db.collection("workOrders").where("date", "==", today).get(),
      stockValue("warehouseReceipts", true, "sklad"),
      stockValue("cexProduction", false, "cex"),
    ]);

    const totalSales = deliveriesSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
    const totalExpenses = expensesSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
    const activeEmployees = employeesSnap.docs.filter((d) => d.data().active).length;

    const statusCounts = { pending: 0, loaded: 0, confirmed: 0 };
    for (const doc of workOrdersSnap.docs) {
      const status = doc.data().status;
      if (statusCounts[status] !== undefined) statusCounts[status] += 1;
    }

    const text =
      `📊 *Bugungi hisobot* (${today})\n\n` +
      `💰 Savdo: *${money.format(totalSales)} so'm*\n` +
      `💸 Xarajat: *${money.format(totalExpenses)} so'm*\n\n` +
      `🏬 Sklad qiymati: ${money.format(Math.round(sklad.totalValue))} so'm\n` +
      `🏭 Sex ombori qoldig'i: ${cex.totalRemaining} dona\n\n` +
      `📋 Zayavkalar: ${workOrdersSnap.size} ta (kutilmoqda: ${statusCounts.pending}, ortildi: ${statusCounts.loaded}, qabul qilindi: ${statusCounts.confirmed})\n` +
      `👥 Faol xodimlar: ${activeEmployees} ta\n\n` +
      `_To'liq boshqaruv, xodimlar/mahsulot tahrirlash, batafsil hisobotlar — veb-panelda (admin.html)._`;

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  return {
    async handleText() {
      return false;
    },
  };
}

module.exports = { register };
