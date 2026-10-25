# Baut das Vue-Frontend. Konfiguration (Backend-Adresse, App-ID, Karten-Key) kommt aus dem
# Overlay-Kontext und ueberschreibt nur src/api/http/config.ts; die geklonten Quellen bleiben unveraendert.
FROM node:16-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Das Lockfile verweist auf registry.npmmirror.com (Alibaba-Mirror). Die URLs lassen sich nicht auf registry.npmjs.org
# umschreiben (anderes Pfadformat, 404). Bewusste Abwägung: exakt die gesperrten Versionen holen; npm prueft jede Datei
# gegen die Pruefsumme im Lockfile (466 Pakete sha1, 211 sha512). Nur fuer den LAN-Test dieser eingestellten Demo.
# registry.nlark.com (192 Pakete) existiert nicht mehr; sein Nachfolger registry.npmmirror.com hat dasselbe Pfadformat.
RUN sed -i 's#https://registry.nlark.com#https://registry.npmmirror.com#g' package-lock.json \
 && npm ci --no-audit --no-fund
COPY . .
COPY --from=overlay config.ts src/api/http/config.ts
# Karte: AMap-Loader per Vite-Alias durch eine Leaflet-Schicht ersetzen, Koordinaten bleiben WGS-84 (keine GCJ-02-Umrechnung).
COPY --from=overlay leaflet-shim/ src/leaflet-shim/
COPY --from=overlay coordtransform.js src/vendors/coordtransform.js
RUN npm install --no-save --no-audit --no-fund --registry=https://registry.npmjs.org/ leaflet@1.9.4 pmtiles@4.5.0 protomaps-leaflet@5.1.0 \
 && echo 'src/leaflet-shim/' >> .eslintignore \
 && sed -i "s#    alias: \[{#    alias: [{\n      find: '@amap/amap-jsapi-loader',\n      replacement: path.resolve(__dirname, './src/leaflet-shim/amap-loader.ts'),\n    }, {#" vite.config.ts \
 && grep -n -A3 "find: '@amap" vite.config.ts
RUN rm -f .npmrc && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY --from=overlay nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
