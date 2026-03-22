/**
 * Google Maps JavaScript API loader + driving directions helper.
 * Enable "Maps JavaScript API" and "Directions API" for your key in Google Cloud Console.
 */
(function (global) {
  let loadPromise = null;

  async function ensureMapsApiKey() {
    const existing = (global.CONFIG?.GOOGLE_MAPS_API_KEY != null
      ? String(global.CONFIG.GOOGLE_MAPS_API_KEY).trim()
      : '');
    if (existing) {
      global.CONFIG.GOOGLE_MAPS_API_KEY = existing;
      return;
    }
    const base = global.CONFIG?.API_BASE;
    if (!base) return;
    try {
      const r = await fetch(base + '/config/client');
      if (!r.ok) return;
      const d = await r.json();
      const k = (d.googleMapsApiKey && String(d.googleMapsApiKey).trim()) || '';
      if (k) {
        if (!global.CONFIG) global.CONFIG = {};
        global.CONFIG.GOOGLE_MAPS_API_KEY = k;
      }
    } catch (_) {
      /* e.g. backend not running, or opened as file:// */
    }
  }

  function loadScript() {
    if (global.google?.maps?.Map) return Promise.resolve();
    if (!loadPromise) {
      loadPromise = loadScriptImpl().catch(err => {
        loadPromise = null;
        throw err;
      });
    }
    return loadPromise;
  }

  async function loadScriptImpl() {
    await ensureMapsApiKey();
    const key = String(global.CONFIG?.GOOGLE_MAPS_API_KEY || '').trim();
    if (!key) {
      throw new Error(
        'Google Maps API key missing. Set GOOGLE_MAPS_API_KEY in backend/.env and restart the server '
        + '(recommended), or set GOOGLE_MAPS_API_KEY in frontend/js/config.js. '
        + 'Enable Maps JavaScript API + Directions API for that key in Google Cloud.'
      );
    }
    global.CONFIG.GOOGLE_MAPS_API_KEY = key;

    return new Promise((resolve, reject) => {
      const cb = '__pranGoogleMapsInit';
      let settled = false;
      const done = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        delete global[cb];
        if (window.gm_authFailure === onGmAuthFailure) window.gm_authFailure = undefined;
        if (ok) resolve();
        else reject(err);
      };

      const onGmAuthFailure = function () {
        done(false, new Error(
          'Google Maps rejected this API key. In Google Cloud: link a billing account to the project, '
          + 'enable "Maps JavaScript API" and "Directions API", and use a Browser/API key. '
          + 'Open DevTools (F12) → Console for the exact Google error.'
        ));
      };
      window.gm_authFailure = onGmAuthFailure;

      const timeoutId = setTimeout(() => {
        done(false, new Error(
          'Google Maps did not load in time. Check: internet connection, ad-blockers, '
          + 'and that https://maps.googleapis.com is not blocked. Also confirm your API key is valid.'
        ));
      }, 30000);

      global[cb] = function () {
        done(true);
      };

      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key='
        + encodeURIComponent(key)
        + '&callback=' + cb + '&v=weekly';
      s.async = true;
      s.onerror = () => {
        done(false, new Error('Could not load the Google Maps script (network error or blocked).'));
      };
      document.head.appendChild(s);
    });
  }

  function ll(lat, lng) {
    return { lat, lng };
  }

  function fromLatLngArray(arr) {
    return { lat: arr[0], lng: arr[1] };
  }

  function createMap(containerEl, centerLatLngArray, options) {
    const o = options || {};
    const mapOpts = {
      center: fromLatLngArray(centerLatLngArray),
      zoom: o.zoom != null ? o.zoom : 14,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: o.gestureHandling || 'greedy'
    };
    if (o.mapId) mapOpts.mapId = o.mapId;
    return new google.maps.Map(containerEl, mapOpts);
  }

  function emojiMarkerIcon(emoji) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">'
      + '<text x="6" y="34" font-size="30">' + emoji + '</text></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 34)
    };
  }

  function pillMarkerIcon(text, bg, color) {
    const w = Math.max(52, text.length * 7 + 20);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="28">'
      + '<rect rx="6" width="' + w + '" height="28" fill="' + bg + '"/>'
      + '<text x="' + (w / 2) + '" y="19" text-anchor="middle" fill="' + color
      + '" font-family="system-ui,sans-serif" font-size="11" font-weight="700">' + text + '</text></svg>';
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(w, 28),
      anchor: new google.maps.Point(w / 2, 14)
    };
  }

  /**
   * Uses classic DirectionsService (Directions API). Google may log a deprecation notice pointing to
   * https://developers.google.com/maps/documentation/javascript/routes/routes-js-migration — routing
   * still works; migrating to Routes API is optional until Google removes this path.
   */
  function computeDrivingRoute(origin, destination) {
    const service = new google.maps.DirectionsService();
    return new Promise((resolve, reject) => {
      service.route(
        {
          origin,
          destination,
          travelMode: google.maps.TravelMode.DRIVING,
          region: 'IN'
        },
        (result, status) => {
          if (status !== 'OK' || !result?.routes?.[0]) {
            reject(new Error(status));
            return;
          }
          let distanceM = 0;
          let durationSec = 0;
          result.routes[0].legs.forEach(leg => {
            distanceM += leg.distance.value;
            durationSec += leg.duration.value;
          });
          resolve({
            result,
            distanceM,
            durationSec,
            bounds: result.routes[0].bounds
          });
        }
      );
    });
  }

  global.PranMaps = {
    loadScript,
    ll,
    fromLatLngArray,
    createMap,
    emojiMarkerIcon,
    pillMarkerIcon,
    computeDrivingRoute
  };
})(typeof window !== 'undefined' ? window : this);
