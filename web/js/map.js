/**
 * map.js — everything around Leaflet.
 *
 * Tile sources follow the terms of their providers:
 * visible attribution, no bulk caching of tiles,
 * only load what is currently being viewed.
 */

import { store } from './store.js';

export const KACHELN = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    optionen: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  'osm-de': {
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    optionen: {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    optionen: {
      maxZoom: 17,
      subdomains: 'abc',
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'style <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
};

/** Drop-shaped pin in the color of the first tag. */
export function pinIcon(farbe, mehrfach = false) {
  return L.divIcon({
    className: '',
    html: `<div class="pinmark${mehrfach ? ' pinmark--mehr' : ''}" style="background:${farbe}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

export class Karte {
  /**
   * @param {string} elementId
   * @param {object} opts { beiKlickPin, beiKlickKarte }
   */
  constructor(elementId, opts = {}) {
    this.opts = opts;
    this.marker = new Map(); // pinId -> L.Marker

    const start = store.einstellungen.letzteAnsicht;
    this.map = L.map(elementId, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      tap: true,
    }).setView(
      start ? [start.lat, start.lon] : [51.0, 10.0],
      start ? start.zoom : 5
    );

    this.kachelSchicht = null;
    this.setzeKacheln(store.einstellungen.kacheln);

    this.cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyDistanceMultiplier: 1.4,
      maxClusterRadius: 45,
      // Do not cluster pins that are very close together, otherwise you
      // never see the neighbors that were deliberately kept separate.
      disableClusteringAtZoom: 17,
    });
    this.map.addLayer(this.cluster);

    this.map.on('moveend zoomend', () => {
      const c = this.map.getCenter();
      store.setzeEinstellung('letzteAnsicht', {
        lat: c.lat, lon: c.lng, zoom: this.map.getZoom(),
      });
    });

    if (opts.beiKlickKarte) {
      this.map.on('click', (e) => opts.beiKlickKarte(e.latlng.lat, e.latlng.lng));
    }
  }

  setzeKacheln(name) {
    const wahl = KACHELN[name] || KACHELN.osm;
    if (this.kachelSchicht) this.map.removeLayer(this.kachelSchicht);
    this.kachelSchicht = L.tileLayer(wahl.url, wahl.optionen).addTo(this.map);
  }

  /** Redraws all pins. At this scale that is cheaper than bookkeeping. */
  zeichne(pins) {
    this.cluster.clearLayers();
    this.marker.clear();

    for (const pin of pins) {
      const m = L.marker([pin.lat, pin.lon], {
        icon: pinIcon(store.pinFarbe(pin), (pin.posts || []).length > 1),
        title: pin.title,
        alt: pin.title,
        keyboard: true,
        riseOnHover: true,
      });
      m.on('click', () => this.opts.beiKlickPin?.(pin.id));
      m.on('keypress', (e) => {
        if (e.originalEvent?.key === 'Enter') this.opts.beiKlickPin?.(pin.id);
      });
      this.marker.set(pin.id, m);
      this.cluster.addLayer(m);
    }
  }

  /**
   * Jumps to a pin.
   *
   * Deliberately without MarkerCluster's zoomToShowLayer: it attaches a one-off
   * moveend listener and accesses the marker inside it. If the map is redrawn
   * in the meantime, it hits a removed marker and throws. Since clustering is
   * off from zoom level 17 anyway (disableClusteringAtZoom), jumping to that
   * level is enough: the pin then stands on its own.
   */
  zuPin(pinId, zoom = 17) {
    const pin = store.pin(pinId);
    if (!pin) return;
    this.map.setView(
      [pin.lat, pin.lon],
      Math.max(this.map.getZoom(), zoom),
      { animate: false }
    );
  }

  zu(lat, lon, zoom = 15) {
    this.map.setView([lat, lon], zoom, { animate: true });
  }

  passeAn(pins) {
    if (!pins.length) return;
    const b = L.latLngBounds(pins.map((p) => [p.lat, p.lon]));
    this.map.fitBounds(b.pad(0.15), { maxZoom: 15 });
  }

  neuMessen() {
    // After switching views, Leaflet does not know its size yet.
    setTimeout(() => this.map.invalidateSize(), 60);
  }
}

/* ------------------------------------------------------------------ *
 * Small preview map in the dialogs
 * ------------------------------------------------------------------ */

export class Vorschaukarte {
  constructor(elementId) {
    this.elementId = elementId;
    this.map = null;
    this.gruppe = null;
  }

  _stelleSicher() {
    if (this.map) return;
    const el = document.getElementById(this.elementId);
    if (!el) return;
    const wahl = KACHELN[store.einstellungen.kacheln] || KACHELN.osm;
    this.map = L.map(el, {
      zoomControl: false, attributionControl: true,
      dragging: true, scrollWheelZoom: false, doubleClickZoom: false,
    }).setView([51, 10], 4);
    L.tileLayer(wahl.url, wahl.optionen).addTo(this.map);
    this.gruppe = L.layerGroup().addTo(this.map);
  }

  /** @param {Array} punkte [{lat, lon, farbe, titel}] */
  zeige(punkte, zoom = 16) {
    this._stelleSicher();
    if (!this.map) return;
    this.gruppe.clearLayers();

    for (const p of punkte) {
      L.marker([p.lat, p.lon], { icon: pinIcon(p.farbe || '#b8543f'), title: p.titel || '' })
        .addTo(this.gruppe);
    }

    setTimeout(() => {
      this.map.invalidateSize();
      if (punkte.length === 1) {
        this.map.setView([punkte[0].lat, punkte[0].lon], zoom);
      } else if (punkte.length > 1) {
        this.map.fitBounds(L.latLngBounds(punkte.map((p) => [p.lat, p.lon])).pad(0.4), { maxZoom: 17 });
      }
    }, 60);
  }

  aufraeumen() {
    if (this.map) { this.map.remove(); this.map = null; this.gruppe = null; }
  }
}
