'use strict';

// Pure offline reference only. This module NEVER initializes window.FH2,
// loads paas.js, requests credentials, sends messages or dispatches flights.
// The real DJI runtime requires a separate, explicitly reviewed integration.
(function exposeReference(globalScope) {
  const componentData = {
    routeCreation: {
      djiLoad: 'loadWaylineCreation',
      djiDestroy: 'destroyWaylineCreation',
      category: 'route-write',
      demo: 'demo/en/wayline-creaction.html'
    },
    routeEditor: {
      djiLoad: 'loadWayline',
      djiDestroy: 'destroyWayline',
      category: 'route-write',
      demo: 'demo/en/wayline.html'
    },
    projectMap: {
      djiLoad: 'loadProject',
      djiDestroy: 'destroyProject',
      category: 'mixed-project-view',
      demo: 'demo/en/project.html'
    },
    flightPath: {
      djiLoad: 'loadFlightPath',
      djiDestroy: 'destroyFlightPath',
      category: 'flight-record-view',
      demo: 'demo/en/flight-path_en.html'
    },
    virtualCockpit: {
      djiLoad: 'loadCockpit',
      djiDestroy: 'destroyCockpit',
      category: 'live-flight-control',
      demo: 'demo/en/cockpit.html'
    }
  };
  const eventData = {
    'wayline-save': 'external-wayline-save',
    'wayline-cancel': 'external-wayline-cancel',
    'wayline-back': 'editor-navigation',
    'wayline-creation-saved': 'external-wayline-save',
    'wayline-creation-cancel': 'external-wayline-cancel',
    'cesium-viewer-change': 'viewer-lifecycle',
    'flight-path-back': 'record-navigation'
  };
  const baselineGates = Object.freeze([
    'fh2-on-prem-runtime-and-license',
    'version-and-documentation-pinned',
    'supported-device-model-confirmed-by-dji',
    'workspace-and-project-boundary-reviewed',
    'organization-key-browser-exposure-blocked-or-explicitly-resolved',
    'approved-credential-lifecycle',
    'https-wss-and-origin-allowlist',
    'csp-and-third-party-script-review',
    'map-css-and-component-lifecycle-review',
    'no-implicit-skyhub-writes-or-cross-system-sync',
    'security-review-and-operator-audit'
  ]);
  const writeGates = Object.freeze([
    'separate-route-write-authorization',
    'explicit-external-save-and-rollback-review'
  ]);
  const cockpitGates = Object.freeze([
    'separate-pilot-command-authorization',
    'emergency-stop-and-loss-of-link-plan',
    'hardware-and-firmware-e2e-validation',
    'explicit-flight-operator-approval'
  ]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const components = Object.freeze(Object.fromEntries(
    Object.entries(componentData).map(([key, value]) =>
      [key, Object.freeze({ ...value, key })]
    )
  ));
  const events = Object.freeze({ ...eventData });

  function describeComponent(key) {
    if (typeof key !== 'string' || !own(components, key)) return null;
    return components[key];
  }

  function reviewGates(key) {
    const component = describeComponent(key);
    if (!component) return null;
    const gates = [...baselineGates];
    if (component.category === 'route-write' ||
        component.category === 'mixed-project-view') {
      gates.push(...writeGates);
    }
    if (component.category === 'live-flight-control') {
      gates.push(...cockpitGates);
    }
    return Object.freeze(gates);
  }

  // Only labels are returned; no callback arguments, route IDs, SNs, tokens,
  // coordinates, Cesium instance references or DJI event payloads are copied.
  function classifyEvent(eventName) {
    if (typeof eventName !== 'string' || !own(events, eventName)) return null;
    return Object.freeze({
      eventName,
      category: events[eventName],
      source: 'untrusted-flightHub2-ui',
      externalPayloadForwarded: false,
      skyHubWriteAuthorized: false,
      flightCommandAuthorized: false
    });
  }

  // Intentionally NOT a feature flag or authorization check. No caller can
  // switch this reference module into a live DJI adapter by passing options.
  function integrationStatus() {
    return Object.freeze({
      mode: 'reference-only',
      runtimeLoaded: false,
      integrationEnabled: false,
      tokenHandlingApproved: false,
      flightControlEnabled: false,
      routesWritable: false,
      backendMounted: false,
      hardwareVerified: false
    });
  }

  const api = Object.freeze({
    components,
    describeComponent,
    reviewGates,
    classifyEvent,
    integrationStatus
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope && typeof globalScope.window === 'object' &&
      globalScope.window && !Object.prototype.hasOwnProperty.call(globalScope.window, 'SkyHubFH2Reference')) {
    Object.defineProperty(globalScope.window, 'SkyHubFH2Reference', {
      value: api, writable: false, configurable: false
    });
  }
})(typeof globalThis === 'object' ? globalThis : undefined);
