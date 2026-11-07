// Local DJI DevKit lab UI translations. No third-party dependency, storage or API calls.
// This overlay is applied only to the pinned V1.1.0 local development copy.
import { ref, computed } from 'vue'

export type LabLocale = 'de' | 'en'
const activeLocale = ref<LabLocale>('de')

const messages: Record<LabLocale, Record<string, string>> = {
  de: {
    dashboard: 'Übersicht', stream: 'Livestream', devices: 'Geräteverwaltung',
    cockpit: 'Cockpit', wayline: 'Routeneditor', tasks: 'Missionen',
    media: 'Medien', airspace: 'Fluggebiete', models: 'Modelle',
    ai: 'KI-Assistent', language: 'Sprache', mock: 'LABOR / MOCK-DATEN',
    mockDetail: 'DJI-Demo: simulierte Daten. Keine Live-Geräte, keine Flugfreigabe.',
    loading: 'Daten werden geladen …', loadError: 'Dashboard konnte nicht geladen werden.',
    assets: 'Gerätebestand', docks: 'Dockingstationen', aircraft: 'Fluggeräte',
    relays: 'Relaisstationen', idle: 'Leerlauf', working: 'Im Einsatz',
    debugging: 'Testbetrieb', offline: 'Offline', results: 'Datenergebnisse',
    mediaCount: 'Medien', modelCount: 'Modelle', reportCount: 'Berichte',
    waylineCount: 'Flugrouten', personnelCount: 'Personal',
    missions: 'Missionen', week: 'Diese Woche', month: 'Dieser Monat',
    recent_week: 'Letzte 7 Tage', recent_month: 'Letzte 30 Tage',
    half_year: 'Letzte 6 Monate', year: 'Letztes Jahr',
    noLive: 'Unbestätigte Laborwerte – nicht mit SkyHub-Telemetrie verwechseln',
    admin: 'Administrator', regularUser: 'Benutzer', manageUsers: 'Benutzerverwaltung',
    themeColor: 'Akzentfarbe', guide: 'Handbuch', logout: 'Abmelden',
  },
  en: {
    dashboard: 'Dashboard', stream: 'Live video', devices: 'Device management',
    cockpit: 'Cockpit', wayline: 'Wayline editor', tasks: 'Missions',
    media: 'Media', airspace: 'Flight areas', models: 'Models',
    ai: 'AI assistant', language: 'Language', mock: 'LAB / MOCK DATA',
    mockDetail: 'DJI demo: synthetic data. No live aircraft or flight clearance.',
    loading: 'Loading data …', loadError: 'Unable to load dashboard.',
    assets: 'Assets', docks: 'Docks', aircraft: 'Aircraft',
    relays: 'Relay stations', idle: 'Idle', working: 'Working',
    debugging: 'Debugging', offline: 'Offline', results: 'Data results',
    mediaCount: 'Media', modelCount: 'Models', reportCount: 'Reports',
    waylineCount: 'Waylines', personnelCount: 'Personnel',
    missions: 'Missions', week: 'This week', month: 'This month',
    recent_week: 'Last 7 days', recent_month: 'Last 30 days',
    half_year: 'Last 6 months', year: 'Last year',
    noLive: 'Unverified lab values – not SkyHub live telemetry',
    admin: 'Administrator', regularUser: 'User', manageUsers: 'User management',
    themeColor: 'Accent color', guide: 'User guide', logout: 'Sign out',
  },
}
export function useLabLocale() {
  const locale = computed(() => activeLocale.value)
  function t(key: string): string {
    return messages[activeLocale.value][key] ?? messages.de[key] ?? key
  }
  function setLocale(value: string): void {
    if (value !== 'de' && value !== 'en') return
    activeLocale.value = value
    if (typeof document !== 'undefined') document.documentElement.lang = value
  }
  return { locale, t, setLocale }
}
