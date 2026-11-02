// @ts-nocheck
/* eslint-disable */
// Ersatz fuer @amap/amap-jsapi-loader: liefert statt der AMap-JS-API die Leaflet-Kompatibilitaetsschicht.
import 'leaflet/dist/leaflet.css'
import { AMap } from './amap'

export function load (_options?: any) {
  return Promise.resolve(AMap)
}
export default { load }
