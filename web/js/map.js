/**
 * map.js — everything around Leaflet.
 *
 * Tile sources follow the terms of their providers:
 * visible attribution, no bulk caching of tiles,
 * only load what is currently being viewed.
 */

import { store } from './store.js';

export const TILES = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  'osm-de': {
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    options: {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 17,
      subdomains: 'abc',
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'style <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
};

/** Drop-shaped pin in the color of the first tag. */
export function pinIcon(color, multiple = false) {
  return L.divIcon({
    className: '',
    html: `<div class="pinmark${multiple ? ' pinmark--multi' : ''}" style="background:${color}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

export class MainMap {
  /**
   * @param {string} elementId
   * @param {object} opts { onPinClick, onMapClick }
   */
  constructor(elementId, opts = {}) {
    this.opts = opts;
    this.markers = new Map(); // pinId -> L.Marker

    const start = store.settings.lastView;
    this.map = L.map(elementId, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      tap: true,
    }).setView(
      start ? [start.lat, start.lon] : [51.0, 10.0],
      start ? start.zoom : 5
    );

    this.tileLayer = null;
    this.setTiles(store.settings.tiles);

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
      store.setSetting('lastView', {
        lat: c.lat, lon: c.lng, zoom: this.map.getZoom(),
      });
    });

    if (opts.onMapClick) {
      this.map.on('click', (e) => opts.onMapClick(e.latlng.lat, e.latlng.lng));
    }
  }

  setTiles(name) {
    const choice = TILES[name] || TILES.osm;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this.tileLayer = L.tileLayer(choice.url, choice.options).addTo(this.map);
  }

  /** Redraws all pins. At this scale that is cheaper than bookkeeping. */
  draw(pins) {
    this.cluster.clearLayers();
    this.markers.clear();

    for (const pin of pins) {
      const m = L.marker([pin.lat, pin.lon], {
        icon: pinIcon(store.pinColor(pin), (pin.posts || []).length > 1),
        title: pin.title,
        alt: pin.title,
        keyboard: true,
        riseOnHover: true,
      });
      m.on('click', () => this.opts.onPinClick?.(pin.id));
      m.on('keypress', (e) => {
        if (e.originalEvent?.key === 'Enter') this.opts.onPinClick?.(pin.id);
      });
      this.markers.set(pin.id, m);
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
  goToPin(pinId, zoom = 17) {
    const pin = store.pin(pinId);
    if (!pin) return;
    this.map.setView(
      [pin.lat, pin.lon],
      Math.max(this.map.getZoom(), zoom),
      { animate: false }
    );
  }

  goTo(lat, lon, zoom = 15) {
    this.map.setView([lat, lon], zoom, { animate: true });
  }

  fitTo(pins) {
    if (!pins.length) return;
    const b = L.latLngBounds(pins.map((p) => [p.lat, p.lon]));
    this.map.fitBounds(b.pad(0.15), { maxZoom: 15 });
  }

  remeasure() {
    // After switching views, Leaflet does not know its size yet.
    setTimeout(() => this.map.invalidateSize(), 60);
  }
}

/* ------------------------------------------------------------------ *
 * Small preview map in the dialogs
 * ------------------------------------------------------------------ */

export class PreviewMap {
  constructor(elementId) {
    this.elementId = elementId;
    this.map = null;
    this.group = null;
  }

  _ensure() {
    if (this.map) return;
    const el = document.getElementById(this.elementId);
    if (!el) return;
    const choice = TILES[store.settings.tiles] || TILES.osm;
    this.map = L.map(el, {
      zoomControl: false, attributionControl: true,
      dragging: true, scrollWheelZoom: false, doubleClickZoom: false,
    }).setView([51, 10], 4);
    L.tileLayer(choice.url, choice.options).addTo(this.map);
    this.group = L.layerGroup().addTo(this.map);
  }

  /** @param {Array} points [{lat, lon, color, title}] */
  show(points, zoom = 16) {
    this._ensure();
    if (!this.map) return;
    this.group.clearLayers();

    for (const p of points) {
      L.marker([p.lat, p.lon], { icon: pinIcon(p.color || '#b8543f'), title: p.title || '' })
        .addTo(this.group);
    }

    setTimeout(() => {
      this.map.invalidateSize();
      if (points.length === 1) {
        this.map.setView([points[0].lat, points[0].lon], zoom);
      } else if (points.length > 1) {
        this.map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])).pad(0.4), { maxZoom: 17 });
      }
    }, 60);
  }

  destroy() {
    if (this.map) { this.map.remove(); this.map = null; this.group = null; }
  }
}
