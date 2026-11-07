// Curated SkyHub-owned navigation and vendor Skill references.
// This catalog does not install DJI tooling or activate device control.
const MODULES=Object.freeze([
  Object.freeze({id:'mission',title:'Missionsvorschau',scope:'WPML / Vermessung',href:'/wpml-survey-preview.html',
    detail:'Vorhandene SkyHub-Vorschau; keine Flugfreigabe, kein Missionsversand.',
    state:'BESTEHENDE SEITE',flightReady:false}),
  Object.freeze({id:'mapping',title:'Mapping & Abdeckung',scope:'GIS / GSD / AGL',href:'/abdeckung.html',
    detail:'Bestehende Vorschau der Fotoabdeckung. Terrain- und Höhenwerte gesondert prüfen.',
    state:'BESTEHENDE SEITE',flightReady:false}),
  Object.freeze({id:'thermal',title:'Thermalanalyse',scope:'DJI R-JPEG / Thermal SDK',href:'/thermal.html',
    detail:'Vorhandene SkyHub-Thermalseite; Messgenauigkeit und Kalibrierung separat bewerten.',
    state:'BESTEHENDE SEITE',flightReady:false})
]);
const SKILLS=Object.freeze([
  Object.freeze({id:'cloudapi2-sdk-core',title:'SDK Core',scope:'Initialisierung, Authentifizierung, Ressourcen-Lebenszyklus'}),
  Object.freeze({id:'cloudapi2-device-management',title:'Device Management',scope:'Gerätestatus, Offline-Ereignisse und Datenherkunft'}),
  Object.freeze({id:'cloudapi2-frontend-component',title:'Frontend Components',scope:'Cockpit, Geräteansichten, Wayline Preview'}),
  Object.freeze({id:'cloudapi2-map',title:'Map',scope:'Kartenkomponenten und Gebietsdaten; nur lesende Referenz'}),
  Object.freeze({id:'cloudapi2-troubleshooting',title:'Troubleshooting',scope:'Fehlercodes, Datenmaskierung und Diagnose'})
]);
const VENDOR_SKILLS='https://github.com/dji-sdk/Cloud-API-2/tree/main/devkit/skills';
export {MODULES,SKILLS,VENDOR_SKILLS};
