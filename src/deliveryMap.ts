/// <reference types="google.maps" />
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

export interface DeliveryPinData {
  lat: number;
  lng: number;
  mapsUrl: string;
  formattedAddress: string;
}

export interface DeliveryMapCallbacks {
  onPinChange: (pin: DeliveryPinData) => void;
  onStatusChange?: (statusText: string, isError?: boolean) => void;
}

// Tier 1: Global Maps JavaScript API auth & quota error listeners (Demo Key quota defense)
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as any)?.code || (err as any)?.status || '';
  return (
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    code === 'OVER_QUERY_LIMIT' ||
    code === 'RESOURCE_EXHAUSTED'
  );
}

function buildGoogleMapsPinUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// Default anchor: Utori Sushi & Donburi (Jl. Sarimanah, Sarijadi, Bandung)
const DEFAULT_CENTER = { lat: -6.8768, lng: 107.5754 };

let loaderConfigured = false;
let mapInstance: google.maps.Map | null = null;
let markerInstance: google.maps.marker.AdvancedMarkerElement | null = null;
let geocoderInstance: google.maps.Geocoder | null = null;
let activeCallbacks: DeliveryMapCallbacks | null = null;
let lastResolvedPin: DeliveryPinData = {
  lat: DEFAULT_CENTER.lat,
  lng: DEFAULT_CENTER.lng,
  mapsUrl: buildGoogleMapsPinUrl(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
  formattedAddress: '',
};

function ensureApiOptions(): string {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('VITE_GOOGLE_MAPS_API_KEY belum tersedia di environment.');
  }
  if (!loaderConfigured) {
    setOptions({
      key: apiKey,
      v: 'weekly',
      language: 'id',
      region: 'ID',
    });
    loaderConfigured = true;
  }
  return apiKey;
}

async function reverseGeocodePosition(lat: number, lng: number): Promise<string> {
  try {
    if (!geocoderInstance) {
      const { Geocoder } = await importLibrary('geocoding');
      geocoderInstance = new Geocoder();
    }
    const { results } = await geocoderInstance.geocode({ location: { lat, lng } });
    if (results && results.length > 0 && results[0].formatted_address) {
      return results[0].formatted_address;
    }
  } catch (err) {
    if (isQuotaError(err)) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    } else {
      console.warn('Reverse geocoding tidak tersedia atau gagal:', err);
    }
  }
  return '';
}

async function updatePinPosition(
  lat: number,
  lng: number,
  options?: {
    formattedAddress?: string;
    shouldReverseGeocode?: boolean;
    panMap?: boolean;
    zoom?: number;
  }
): Promise<DeliveryPinData> {
  const normalizedLat = Number(lat.toFixed(6));
  const normalizedLng = Number(lng.toFixed(6));
  const pos = { lat: normalizedLat, lng: normalizedLng };

  if (markerInstance) {
    markerInstance.position = pos;
  }
  if (mapInstance && options?.panMap !== false) {
    mapInstance.panTo(pos);
    if (typeof options?.zoom === 'number') {
      mapInstance.setZoom(options.zoom);
    }
  }

  let formattedAddress = options?.formattedAddress || '';
  if (!formattedAddress && options?.shouldReverseGeocode !== false) {
    activeCallbacks?.onStatusChange?.('Membaca alamat titik peta...');
    formattedAddress = await reverseGeocodePosition(normalizedLat, normalizedLng);
  }

  lastResolvedPin = {
    lat: normalizedLat,
    lng: normalizedLng,
    mapsUrl: buildGoogleMapsPinUrl(normalizedLat, normalizedLng),
    formattedAddress,
  };

  activeCallbacks?.onPinChange(lastResolvedPin);
  activeCallbacks?.onStatusChange?.(
    formattedAddress
      ? 'Titik lokasi & alamat Google Maps terpasang'
      : 'Titik koordinat Google Maps terpasang'
  );
  return lastResolvedPin;
}

async function initPicker(
  mapContainer: HTMLElement,
  autocompleteHost: HTMLElement | null,
  callbacks: DeliveryMapCallbacks,
  initialPin?: { lat: number; lng: number; formattedAddress?: string } | null
): Promise<void> {
  activeCallbacks = callbacks;
  ensureApiOptions();

  const startPos =
    initialPin && Number.isFinite(initialPin.lat) && Number.isFinite(initialPin.lng)
      ? { lat: initialPin.lat, lng: initialPin.lng }
      : DEFAULT_CENTER;

  const [{ Map }, { AdvancedMarkerElement }, { PlaceAutocompleteElement }] = await Promise.all([
    importLibrary('maps'),
    importLibrary('marker'),
    importLibrary('places'),
  ]);

  if (!mapInstance || mapInstance.getDiv() !== mapContainer) {
    mapContainer.innerHTML = '';
    const mapOptions: google.maps.MapOptions & { internalUsageAttributionIds?: string[] } = {
      center: startPos,
      zoom: initialPin ? 17 : 15,
      mapId: 'DEMO_MAP_ID',
      gestureHandling: 'greedy',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    mapInstance = new Map(mapContainer, mapOptions);

    markerInstance = new AdvancedMarkerElement({
      map: mapInstance,
      position: startPos,
      gmpDraggable: true,
      title: 'Geser atau klik peta untuk menentukan titik antar',
    });

    mapInstance.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      void updatePinPosition(event.latLng.lat(), event.latLng.lng(), {
        panMap: true,
      });
    });

    markerInstance.addListener('dragend', () => {
      const pos = markerInstance?.position;
      if (!pos) return;
      const lat = typeof pos.lat === 'function' ? pos.lat() : Number(pos.lat);
      const lng = typeof pos.lng === 'function' ? pos.lng() : Number(pos.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        void updatePinPosition(lat, lng, { panMap: true });
      }
    });
  } else {
    mapInstance.setCenter(startPos);
    mapInstance.setZoom(initialPin ? 17 : 15);
    if (markerInstance) {
      markerInstance.position = startPos;
    }
  }

  if (autocompleteHost) {
    autocompleteHost.innerHTML = '';
    const placeAutocomplete = new PlaceAutocompleteElement({
      includedRegionCodes: ['id'],
    });
    placeAutocomplete.setAttribute('internal-usage-attribution-ids', 'gmp_mcp_codeassist_v1_aistudio');
    placeAutocomplete.setAttribute('placeholder', 'Cari nama jalan, gedung, atau perumahan...');
    placeAutocomplete.style.width = '100%';
    autocompleteHost.appendChild(placeAutocomplete);

    placeAutocomplete.addEventListener('gmp-select', async (event: any) => {
      try {
        const placePrediction = event?.placePrediction;
        if (!placePrediction) return;
        const place = placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });

        if (place.viewport && mapInstance) {
          mapInstance.fitBounds(place.viewport);
        }

        if (place.location) {
          const lat =
            typeof place.location.lat === 'function'
              ? place.location.lat()
              : Number((place.location as any).lat);
          const lng =
            typeof place.location.lng === 'function'
              ? place.location.lng()
              : Number((place.location as any).lng);
          const displayLabel = [place.displayName, place.formattedAddress]
            .filter(Boolean)
            .join(' — ');
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            await updatePinPosition(lat, lng, {
              formattedAddress: displayLabel || place.formattedAddress || '',
              shouldReverseGeocode: false,
              panMap: true,
              zoom: 17,
            });
          }
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        } else {
          console.error('PlaceAutocomplete gmp-select error:', err);
          activeCallbacks?.onStatusChange?.('Gagal memuat detail lokasi pencarian.', true);
        }
      }
    });
  }

  if (initialPin) {
    lastResolvedPin = {
      lat: Number(initialPin.lat.toFixed(6)),
      lng: Number(initialPin.lng.toFixed(6)),
      mapsUrl: buildGoogleMapsPinUrl(initialPin.lat, initialPin.lng),
      formattedAddress: initialPin.formattedAddress || '',
    };
    activeCallbacks.onPinChange(lastResolvedPin);
  }
}

function requestCurrentPosition(): Promise<DeliveryPinData> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser Anda tidak mendukung GPS / Geolocation.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        try {
          ensureApiOptions();
          const addr = await reverseGeocodePosition(lat, lng);
          const pin: DeliveryPinData = {
            lat,
            lng,
            mapsUrl: buildGoogleMapsPinUrl(lat, lng),
            formattedAddress: addr,
          };
          if (mapInstance && markerInstance) {
            markerInstance.position = { lat, lng };
            mapInstance.panTo({ lat, lng });
            mapInstance.setZoom(17);
          }
          lastResolvedPin = pin;
          activeCallbacks?.onPinChange(pin);
          resolve(pin);
        } catch {
          const pin: DeliveryPinData = {
            lat,
            lng,
            mapsUrl: buildGoogleMapsPinUrl(lat, lng),
            formattedAddress: '',
          };
          lastResolvedPin = pin;
          activeCallbacks?.onPinChange(pin);
          resolve(pin);
        }
      },
      (geoErr) => {
        reject(new Error(geoErr.message || 'Izin lokasi GPS ditolak atau tidak tersedia.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function getCurrentPin(): DeliveryPinData {
  return lastResolvedPin;
}

const UtoriDeliveryMap = {
  initPicker,
  updatePinPosition,
  requestCurrentPosition,
  getCurrentPin,
  buildGoogleMapsPinUrl,
};

(window as any).UtoriDeliveryMap = UtoriDeliveryMap;

export default UtoriDeliveryMap;
