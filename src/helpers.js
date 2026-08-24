const { db } = require("./firebase");

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const money = new Intl.NumberFormat("uz");

async function listProducts() {
  const snap = await db.collection("products").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listVehicles() {
  const snap = await db.collection("vehicles").orderBy("number").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function listStores() {
  const snap = await db.collection("stores").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function vehicleLabel(v) {
  if (!v) return "";
  if (v.model || v.plateNumber) return [v.model, v.plateNumber].filter(Boolean).join(" · ");
  return v.number;
}

/** Inline tugmalarni 2 tadan qatorga bo'lib chiqaradi. */
function grid(items, toBtn, perRow = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow).map(toBtn));
  }
  return rows;
}

module.exports = { todayKey, money, listProducts, listVehicles, listStores, vehicleLabel, grid };
