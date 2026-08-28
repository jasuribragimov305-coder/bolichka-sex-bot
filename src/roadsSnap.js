// Admin saytdagi qizil chiziqni (haydovchining GPS nuqtalari) haqiqiy
// yo'lga moslashtirish uchun Google Roads API'ni server orqali chaqiramiz —
// bu API brauzerdan to'g'ridan-to'g'ri chaqirilganda CORS bilan bloklanadi,
// shuning uchun bot serveri "vositachi" bo'lib ishlaydi.
function sampleEvenly(arr, n) {
  if (arr.length <= n) return arr;
  const step = (arr.length - 1) / (n - 1);
  const result = [];
  for (let i = 0; i < n; i++) result.push(arr[Math.round(i * step)]);
  return result;
}

async function snapToRoads(points) {
  const key = process.env.ROADS_API_KEY;
  if (!key || !Array.isArray(points) || points.length < 2) return points || [];

  const sampled = sampleEvenly(points, 100);
  const path = sampled.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${key}`;

  const res = await fetch(url);
  if (!res.ok) return points;
  const data = await res.json();
  const snapped = (data.snappedPoints || []).map((sp) => ({
    lat: sp.location.latitude,
    lng: sp.location.longitude,
  }));
  return snapped.length > 0 ? snapped : points;
}

module.exports = { snapToRoads };
