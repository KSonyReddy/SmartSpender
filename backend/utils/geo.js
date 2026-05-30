function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidCoordinate(lat, lon) {
  const lt = toFiniteNumber(lat);
  const ln = toFiniteNumber(lon);
  if (lt == null || ln == null) return false;
  return lt >= -90 && lt <= 90 && ln >= -180 && ln <= 180;
}

export function haversineKm(a, b) {
  if (!isValidCoordinate(a?.lat, a?.lon) || !isValidCoordinate(b?.lat, b?.lon)) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180)
    * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function distanceLabel(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '';
  if (distanceKm <= 2) return 'In city';
  return `${distanceKm} km away`;
}

