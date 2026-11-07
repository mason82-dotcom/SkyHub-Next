// OpenStreetMap/Leaflet arbeiten in WGS-84. Die AMap-Variante der Demo rechnete jede Koordinate nach GCJ-02 um und zurueck;
// hier sind beide Richtungen die Identitaet (sonst laegen alle Geraete und Zeichnungen hunderte Meter daneben).
export function wgs84togcj02 (lng, lat) { return [Number(lng), Number(lat)] }
export function gcj02towgs84 (lng, lat) { return [Number(lng), Number(lat)] }
export function transformlng (lng, lat) { return Number(lng) }
export default { wgs84togcj02, gcj02towgs84, transformlng }
