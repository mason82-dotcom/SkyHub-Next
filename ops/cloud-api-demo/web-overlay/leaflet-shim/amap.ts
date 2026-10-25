// @ts-nocheck
/* eslint-disable */
// Teilmenge der AMap-JS-API 2.0 auf Basis von Leaflet/OpenStreetMap, nur das, was die DJI-Cloud-API-Demo benutzt:
// Map, Marker (inkl. moveTo), Polyline, Polygon, Circle, Text, Icon, Size, Pixel, LngLat, MouseTool.
// Bekannte Abweichungen: Polygone sind nicht per Maus verschiebbar (draggable wird ignoriert), Kreise werden per
// Klick (Mitte) und zweitem Klick (Radius) gezeichnet statt per Ziehen, Satellit/Wetter/Routenmessung fehlen.
import L from 'leaflet'
import { PMTiles } from 'pmtiles'
import { leafletLayer } from 'protomaps-leaflet'
import { CURRENT_CONFIG } from '/@/api/http/config'

// protomaps-leaflet liest das globale L erst beim Aufruf von leafletLayer(); hier gesetzt, bevor eine Karte entsteht.
;(window as any).L = L

const cfg: any = CURRENT_CONFIG
const TILE_URL = cfg.mapTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = cfg.mapAttribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'

// Offline-Basiskarten (PMTiles, per HTTP-Range-Anfragen vom eigenen Webserver): Vektorkarte als Standard, Luftbild als Ebene.
function absolute (u: string) { return new URL(u, window.location.origin).href }
function rasterPmtilesLayer (def: any) {
  const archive = new PMTiles(absolute(def.url))
  const Layer = (L.GridLayer as any).extend({
    createTile (coords: any, done: any) {
      const img = document.createElement('img')
      archive.getZxy(coords.z, coords.x, coords.y).then((res: any) => {
        if (!res) return done(null, img)
        const url = URL.createObjectURL(new Blob([res.data], { type: def.mime || 'image/jpeg' }))
        img.onload = () => { URL.revokeObjectURL(url); done(null, img) }
        img.onerror = () => { URL.revokeObjectURL(url); done(null, img) }
        img.src = url
      }).catch(() => done(null, img))
      return img
    },
  })
  const b = def.bounds // [west, south, east, north]
  return new Layer({
    minZoom: def.minZoom ?? 0, maxZoom: 22, minNativeZoom: def.minZoom, maxNativeZoom: def.maxZoom,
    bounds: b ? L.latLngBounds([b[1], b[0]], [b[3], b[2]]) : undefined, attribution: def.attribution || '',
  })
}
function vectorPmtilesLayer (def: any) {
  return (leafletLayer as any)({ url: absolute(def.url), flavor: def.flavor || 'light', lang: def.lang || 'de', maxDataZoom: def.maxZoom ?? 15, attribution: def.attribution || '' })
}

if (typeof document !== 'undefined' && !document.getElementById('amap-shim-style')) {
  const style = document.createElement('style')
  style.id = 'amap-shim-style'
  style.textContent = '.amap-shim-marker{background:none!important;border:none!important;overflow:visible}' +
    '.amap-shim-marker img{max-width:none}.amap-shim-draw{cursor:crosshair!important}'
  document.head.appendChild(style)
}

export class LngLat {
  lng: number
  lat: number
  className = 'Overlay.LngLat'
  constructor (lng: number, lat: number) { this.lng = Number(lng); this.lat = Number(lat) }
  getLng () { return this.lng }
  getLat () { return this.lat }
  toArray () { return [this.lng, this.lat] }
}
export class Pixel { constructor (public x: number, public y: number) {} getX () { return this.x } getY () { return this.y } }
export class Size { constructor (public width: number, public height: number) {} getWidth () { return this.width } getHeight () { return this.height } }
export class Icon {
  image: string
  size: any
  imageSize: any
  constructor (opts: any = {}) { this.image = opts.image; this.size = opts.size; this.imageSize = opts.imageSize }
}

function toLngLat (v: any): LngLat {
  if (v instanceof LngLat) return v
  if (Array.isArray(v)) return new LngLat(v[0], v[1])
  return new LngLat(v.lng ?? v.getLng?.(), v.lat ?? v.getLat?.())
}
const toLatLng = (v: any) => { const p = toLngLat(v); return L.latLng(p.lat, p.lng) }
function toPath (path: any): LngLat[] {
  if (!path) return []
  const ring = Array.isArray(path[0]) && Array.isArray(path[0][0]) ? path[0] : path
  return ring.map(toLngLat)
}
function bearing (a: LngLat, b: LngLat) {
  const r = Math.PI / 180
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}
function offsetOf (o: any): [number, number] {
  if (!o) return [0, 0]
  if (Array.isArray(o)) return [Number(o[0]) || 0, Number(o[1]) || 0]
  return [Number(o.x) || 0, Number(o.y) || 0]
}

const ANCHORS: any = {
  'top-left': [0, 0], 'top-center': [0.5, 0], 'top-right': [1, 0],
  'middle-left': [0, 0.5], center: [0.5, 0.5], 'middle-right': [1, 0.5],
  'bottom-left': [0, 1], 'bottom-center': [0.5, 1], 'bottom-right': [1, 1],
}
const DEFAULT_PIN = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#2d8cf0" stroke="#fff" ' +
  'stroke-width="1.5" d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.6 7.5 13.5 7.5 13.5S19.5 14.6 19.5 9A7.5 7.5 0 0 0 12 1.5z"/>' +
  '<circle cx="12" cy="9" r="2.8" fill="#fff"/></svg>')

function dashOf (o: any): string | undefined {
  if (Array.isArray(o.strokeDasharray) && o.strokeDasharray.length) return o.strokeDasharray.map((n: number) => n * 2).join(' ')
  return o.strokeStyle === 'dashed' ? '8 6' : undefined
}
function shapeStyle (o: any, fill: boolean) {
  const s: any = {
    color: o.strokeColor || '#006600', opacity: o.strokeOpacity ?? 0.9, weight: o.strokeWeight ?? 2, dashArray: dashOf(o),
    fill, interactive: true,
  }
  if (fill) { s.fillColor = o.fillColor || '#006600'; s.fillOpacity = o.fillOpacity ?? 0.5 }
  return s
}

class Overlay {
  _originOpts: any
  _opts: any
  _extData: any
  _map: any = null
  _layer: any = null
  _handlers: any = {}
  constructor (opts: any = {}) {
    this._originOpts = opts
    this._opts = { ...opts }
    this._extData = opts.extData
  }
  _attach () {
    for (const type of ['click', 'dblclick', 'mouseover', 'mouseout']) {
      this._layer.on(type, (e: any) => this._emit(type, { lnglat: e.latlng ? new LngLat(e.latlng.lng, e.latlng.lat) : undefined, originEvent: e.originalEvent }))
    }
    if (this._opts.map) this._opts.map.add(this)
  }
  _emit (type: string, extra: any = {}) { (this._handlers[type] || []).slice().forEach((fn: any) => fn({ type, target: this, ...extra })) }
  on (type: string, fn: any) { const l = (this._handlers[type] = this._handlers[type] || []); if (!l.includes(fn)) l.push(fn); return this }
  off (type: string, fn?: any) { this._handlers[type] = fn ? (this._handlers[type] || []).filter((f: any) => f !== fn) : []; return this }
  getExtData () { return this._extData }
  setExtData (d: any) { this._extData = d; this._opts.extData = d }
  getOptions () { return { ...this._opts } }
  getMap () { return this._map }
  setMap (map: any) {
    if (this._map && this._layer) this._map._leaflet.removeLayer(this._layer)
    this._map = map || null
    if (map && this._layer) this._layer.addTo(map._leaflet)
  }
  hide () { if (this._map && this._layer) this._map._leaflet.removeLayer(this._layer) }
  show () { if (this._map && this._layer) this._layer.addTo(this._map._leaflet) }
}

export class Marker extends Overlay {
  _pos: LngLat
  _angle = 0
  _anim: any = null
  constructor (opts: any = {}) {
    super(opts)
    this._pos = toLngLat(opts.position || [0, 0])
    this._angle = Number(opts.angle) || 0
    this._layer = L.marker(toLatLng(this._pos), { icon: this._icon(), title: opts.title || '', keyboard: false, riseOnHover: true, bubblingMouseEvents: true })
    this._attach()
  }
  _icon () {
    const o = this._opts
    const ico: any = o.icon
    const url = typeof ico === 'string' ? ico : (ico && ico.image) || DEFAULT_PIN
    const size = ico && typeof ico === 'object' ? (ico.imageSize || ico.size) : null
    const [ax, ay] = ANCHORS[o.anchor] || ANCHORS['bottom-center']
    const [ox, oy] = offsetOf(o.offset)
    const img = document.createElement('img')
    img.src = url
    img.draggable = false
    img.style.cssText = 'position:absolute;left:0;top:0;display:block;user-select:none;' +
      (size ? `width:${size.width}px;height:${size.height}px;` : '') +
      `transform-origin:50% 50%;transform:translate(${-ax * 100}%,${-ay * 100}%) translate(${ox}px,${oy}px) rotate(${this._angle}deg)`
    return L.divIcon({ html: img, className: 'amap-shim-marker', iconSize: [0, 0], iconAnchor: [0, 0] })
  }
  getPosition () { return this._pos }
  setPosition (p: any) { this._pos = toLngLat(p); this._opts.position = this._pos; this._layer.setLatLng(toLatLng(this._pos)) }
  setIcon (icon: any) { this._opts.icon = icon; this._layer.setIcon(this._icon()) }
  setAngle (deg: number) { this._angle = deg; this._opts.angle = deg; this._layer.setIcon(this._icon()) }
  getTitle () { return this._opts.title }
  setTitle (t: string) {
    this._opts.title = t
    this._originOpts.title = t
    const el = this._layer.getElement?.()
    if (el) el.setAttribute('title', t)
  }
  stopMove () { if (this._anim) cancelAnimationFrame(this._anim); this._anim = null }
  moveTo (target: any, o: any = {}) {
    this.stopMove()
    const from = this._pos
    const to = toLngLat(target)
    const duration = Math.max(1, Number(o.duration) || 1000)
    if (o.autoRotation && (Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat)) > 5e-6) this.setAngle(bearing(from, to))
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration)
      this.setPosition(new LngLat(from.lng + (to.lng - from.lng) * k, from.lat + (to.lat - from.lat) * k))
      this._anim = k < 1 ? requestAnimationFrame(step) : null
    }
    this._anim = requestAnimationFrame(step)
  }
}
export class ElasticMarker extends Marker {}

export class Polyline extends Overlay {
  _path: LngLat[]
  constructor (opts: any = {}) {
    super(opts)
    this._path = toPath(opts.path)
    this._layer = this._create()
    this._attach()
  }
  _create () { return L.polyline(this._path.map(toLatLng), shapeStyle(this._opts, false)) }
  getPath () { return this._path.slice() }
  setPath (p: any) { this._path = toPath(p); this._opts.path = this._path; this._layer.setLatLngs(this._path.map(toLatLng)) }
  setOptions (o: any) {
    Object.assign(this._opts, o)
    if (o.path) this.setPath(o.path)
    this._layer.setStyle(shapeStyle(this._opts, false))
  }
}
export class Polygon extends Polyline {
  _create () { return L.polygon(this._path.map(toLatLng), shapeStyle(this._opts, true)) }
  setOptions (o: any) {
    Object.assign(this._opts, o)
    if (o.path) this.setPath(o.path)
    this._layer.setStyle(shapeStyle(this._opts, true))
  }
}

export class Circle extends Overlay {
  _center: LngLat
  _radius: number
  constructor (opts: any = {}) {
    super(opts)
    this._center = toLngLat(opts.center || [0, 0])
    this._radius = Number(opts.radius) || 0
    this._layer = L.circle(toLatLng(this._center), { ...shapeStyle(this._opts, true), radius: this._radius })
    this._attach()
  }
  getCenter () { return this._center }
  getRadius () { return this._radius }
  setCenter (c: any) { this._center = toLngLat(c); this._opts.center = this._center; this._layer.setLatLng(toLatLng(this._center)) }
  setRadius (r: number) { this._radius = Number(r); this._opts.radius = this._radius; this._layer.setRadius(this._radius) }
  setOptions (o: any) {
    Object.assign(this._opts, o)
    if (o.center) this.setCenter(o.center)
    if (o.radius !== undefined) this.setRadius(o.radius)
    this._layer.setStyle(shapeStyle(this._opts, true))
  }
}

export class Text extends Overlay {
  _pos: LngLat
  constructor (opts: any = {}) {
    super(opts)
    this._pos = toLngLat(opts.position || [0, 0])
    this._layer = L.marker(toLatLng(this._pos), { icon: this._icon(), interactive: false, keyboard: false })
    this._attach()
  }
  _icon () {
    const o = this._opts
    const [ax, ay] = ANCHORS[o.anchor] || ANCHORS.center
    const [ox, oy] = offsetOf(o.offset)
    const el = document.createElement('div')
    el.textContent = o.text || ''
    el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;padding:2px 4px;color:#222;text-shadow:0 0 3px #fff;` +
      `transform:translate(${-ax * 100}%,${-ay * 100}%) translate(${ox}px,${oy}px)`
    Object.assign(el.style, o.style || {})
    return L.divIcon({ html: el, className: 'amap-shim-marker', iconSize: [0, 0], iconAnchor: [0, 0] })
  }
  getText () { return this._opts.text }
  setText (t: string) { this._opts.text = t; this._layer.setIcon(this._icon()) }
  getPosition () { return this._pos }
  setPosition (p: any) { this._pos = toLngLat(p); this._opts.position = this._pos; this._layer.setLatLng(toLatLng(this._pos)) }
}

export class Map {
  _leaflet: any
  constructor (container: any, opts: any = {}) {
    const center = Array.isArray(cfg.mapCenter) && cfg.mapCenter.length === 2 ? cfg.mapCenter : (opts.center || [10.4515, 51.1657])
    const zoom = cfg.mapZoom ?? opts.zoom ?? 6
    this._leaflet = L.map(container, { center: [center[1], center[0]], zoom, minZoom: 2, maxZoom: 22, zoomControl: true, attributionControl: true })
    const map = this._leaflet
    const osm = L.tileLayer(TILE_URL, { maxNativeZoom: 19, maxZoom: 22, attribution: ATTRIBUTION })
    const basemaps: any[] = Array.isArray(cfg.mapBasemaps) ? cfg.mapBasemaps : []
    const vector = basemaps.find((b: any) => b.type === 'vector')
    const aerial = basemaps.find((b: any) => b.type === 'raster')
    if (!vector && !aerial) {
      osm.addTo(map) // keine Offline-Karten konfiguriert: OpenStreetMap online wie zuvor
    } else {
      const bases: any = {}
      if (vector) { const v = vectorPmtilesLayer(vector); bases[vector.name] = v; v.addTo(map) } else { bases['OpenStreetMap (online)'] = osm; osm.addTo(map) }
      if (vector) bases['OpenStreetMap (online)'] = osm
      const overlays: any = {}
      if (aerial) overlays[aerial.name] = rasterPmtilesLayer(aerial)
      L.control.layers(bases, overlays, { collapsed: true, position: 'topright' }).addTo(map)
    }
    setTimeout(() => this._leaflet.invalidateSize(), 200)
  }
  add (x: any) { (Array.isArray(x) ? x : [x]).forEach((o: any) => o && o.setMap(this)); return this }
  remove (x: any) { (Array.isArray(x) ? x : [x]).forEach((o: any) => o && o.setMap(null)); return this }
  // Die Demo ruft panTo() und gleich danach setZoom() auf. In Leaflet setzt setZoom() die Ansicht auf die ALTE Mitte
  // zurueck und verwirft das Schwenken; AMap fuehrt beides nacheinander aus. Deshalb merkt sich die Schicht das Schwenkziel.
  _target: any = null
  panTo (c: any, duration?: number) {
    const ll = toLatLng(c)
    this._target = ll
    this._leaflet.panTo(ll, { animate: true, duration: (duration || 250) / 1000 })
    this._leaflet.once('moveend', () => { if (this._target === ll) this._target = null })
  }
  setZoom (z: number, immediately?: boolean) {
    const ll = this._target || this._leaflet.getCenter()
    this._target = null
    this._leaflet.setView(ll, z, { animate: !immediately })
  }
  getZoom () { return this._leaflet.getZoom() }
  setCenter (c: any) { this._leaflet.setView(toLatLng(c)) }
  getCenter () { const c = this._leaflet.getCenter(); return new LngLat(c.lng, c.lat) }
  setFitView (overlays: any[]) {
    const b = L.latLngBounds([])
    ;(overlays || []).forEach((o: any) => o && o._layer && b.extend(o._layer.getBounds ? o._layer.getBounds() : o._layer.getLatLng()))
    if (b.isValid()) this._leaflet.fitBounds(b, { maxZoom: 18 })
  }
  clearMap () { this._leaflet.eachLayer((l: any) => { if (!(l instanceof L.TileLayer)) this._leaflet.removeLayer(l) }) }
  on (type: string, fn: any) { this._leaflet.on(type, fn) }
  off (type: string, fn?: any) { this._leaflet.off(type, fn) }
  destroy () { this._leaflet.remove() }
}

// Zeichenwerkzeug: Pin (Klick), Linie/Polygon (Klicks, Doppelklick beendet), Kreis (Klick Mitte, Klick Radius).
// Wie bei AMap bleibt der Modus aktiv, bis close() gerufen wird; 'draw' liefert { obj }.
export class MouseTool {
  _map: any
  _handlers: any = {}
  _stop: any = null
  constructor (map: any) { this._map = map }
  on (type: string, fn: any) { const l = (this._handlers[type] = this._handlers[type] || []); if (!l.includes(fn)) l.push(fn); return this }
  off (type: string, fn?: any) { this._handlers[type] = fn ? (this._handlers[type] || []).filter((f: any) => f !== fn) : []; return this }
  _fire (obj: any) { (this._handlers.draw || []).slice().forEach((fn: any) => fn({ obj })) }
  close () { if (this._stop) this._stop(); this._stop = null }
  _begin (setup: (m: any, done: () => void) => void) {
    this.close()
    const m = this._map._leaflet
    const el = m.getContainer()
    el.classList.add('amap-shim-draw')
    m.doubleClickZoom.disable()
    const temps: any[] = []
    const cleanup = setup(m, temps) || (() => {})
    this._stop = () => {
      cleanup()
      temps.forEach(t => m.removeLayer(t))
      el.classList.remove('amap-shim-draw')
      m.doubleClickZoom.enable()
    }
  }
  marker (opts: any = {}) {
    this._begin((m) => {
      const onClick = (e: any) => { const o = new Marker({ ...opts, position: [e.latlng.lng, e.latlng.lat] }); this._map.add(o); this._fire(o) }
      m.on('click', onClick)
      return () => m.off('click', onClick)
    })
  }
  _poly (opts: any, min: number, polygon: boolean) {
    this._begin((m, temps) => {
      let pts: any[] = []
      let preview: any = null
      const style = { ...shapeStyle(opts, polygon), interactive: false } // Vorschau faengt keine Klicks ab
      const redraw = (extra?: any) => {
        if (preview) m.removeLayer(preview)
        const ll = extra ? [...pts, extra] : pts
        preview = polygon ? L.polygon(ll, style) : L.polyline(ll, style)
        preview.addTo(m)
        temps[0] = preview
      }
      const onClick = (e: any) => { pts.push(e.latlng); redraw() }
      const onMove = (e: any) => { if (pts.length) redraw(e.latlng) }
      const onDbl = () => {
        if (pts.length > 1) pts.pop() // der zweite Klick des Doppelklicks hat denselben Punkt doppelt gesetzt
        if (pts.length >= min) {
          const path = pts.map(p => [p.lng, p.lat])
          const o = polygon ? new Polygon({ ...opts, path }) : new Polyline({ ...opts, path })
          this._map.add(o)
          this._fire(o)
        }
        pts = []
        if (preview) { m.removeLayer(preview); preview = null; temps.length = 0 }
      }
      m.on('click', onClick); m.on('mousemove', onMove); m.on('dblclick', onDbl)
      return () => { m.off('click', onClick); m.off('mousemove', onMove); m.off('dblclick', onDbl) }
    })
  }
  polyline (opts: any = {}) { this._poly(opts, 2, false) }
  polygon (opts: any = {}) { this._poly(opts, 3, true) }
  circle (opts: any = {}) {
    this._begin((m, temps) => {
      let center: any = null
      let preview: any = null
      const style = { ...shapeStyle(opts, true), interactive: false }
      const onClick = (e: any) => {
        if (!center) {
          center = e.latlng
          preview = L.circle(center, { ...style, radius: 1 }).addTo(m)
          temps[0] = preview
          return
        }
        const radius = m.distance(center, e.latlng)
        const o = new Circle({ ...opts, center: [center.lng, center.lat], radius })
        m.removeLayer(preview); temps.length = 0; preview = null; center = null
        this._map.add(o)
        this._fire(o)
      }
      const onMove = (e: any) => { if (center && preview) preview.setRadius(Math.max(1, m.distance(center, e.latlng))) }
      m.on('click', onClick); m.on('mousemove', onMove)
      return () => { m.off('click', onClick); m.off('mousemove', onMove) }
    })
  }
}

// Plugins, die die Demo nur in der Ladeliste nennt bzw. nicht aktiv nutzt: unschaedliche Platzhalter.
class Noop { constructor (..._args: any[]) {} open () {} close () {} on () { return this } off () { return this } setTarget () {} }
class Geocoder extends Noop { getAddress (_c: any, cb: any) { cb && cb('no_data', {}) } }

export const AMap = {
  Map, Marker, ElasticMarker, Polyline, Polygon, Circle, Text, Icon, Size, Pixel, LngLat, MouseTool,
  ToolBar: Noop, Scale: Noop, ControlBar: Noop, MapType: Noop, Weather: Noop, RangingTool: Noop, MoveAnimation: Noop,
  PolygonEditor: Noop, PolylineEditor: Noop, PolyEditor: Noop, CircleEditor: Noop, Geocoder,
}
