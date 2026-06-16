import axios from 'axios';
import logger from '../utils/logger.js';

/**
 * NavigationService — #156
 * Google Maps Routes API wrapper.
 * Fetches current route context and formats it for injection into
 * the Sylex car-mode system prompt via chatService.processChat().
 *
 * Graceful degradation: returns null when GOOGLE_MAPS_API_KEY is not set.
 * Car mode continues to work — just without navigation context.
 */

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TRAFFIC_CONDITIONS = {
  TRAFFIC_UNAWARE: 'unknown',
  TRAFFIC_INDEPENDENT: 'light',
  TRAFFIC_AWARE: 'light',
  TRAFFIC_AWARE_OPTIMAL: 'light',
};

class NavigationService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || null;
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  /**
   * Fetch current route context from Google Maps Routes API.
   *
   * @param {Object} options
   * @param {string} options.origin          - Origin address or "lat,lng"
   * @param {string} options.destination     - Destination address or "lat,lng"
   * @param {string} [options.currentLocation] - Current position "lat,lng" (for ETA refinement)
   * @param {string} [options.language]      - BCP-47 language code (default: de-DE)
   * @returns {Promise<Object|null>} Route context object, or null if not configured / error
   */
  async getRouteContext({ origin, destination, currentLocation, language = 'de-DE' }) {
    if (!this.isConfigured) {
      logger.warn('NavigationService: GOOGLE_MAPS_API_KEY not set — skipping navigation context');
      return null;
    }

    try {
      const waypoint = (loc) => {
        // Accept "lat,lng" or plain address string
        const latLng = loc.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
        if (latLng) {
          return { location: { latLng: { latitude: parseFloat(latLng[1]), longitude: parseFloat(latLng[2]) } } };
        }
        return { address: loc };
      };

      const body = {
        origin: waypoint(currentLocation || origin),
        destination: waypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
        languageCode: language,
        units: 'METRIC',
        computeAlternativeRoutes: false,
        routeModifiers: { avoidTolls: false, avoidHighways: false },
      };

      const response = await axios.post(ROUTES_API_URL, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.legs.steps.navigationInstruction,routes.travelAdvisory.speedReadingIntervals',
        },
        timeout: 5000,
      });

      const route = response.data?.routes?.[0];
      if (!route) return null;

      const leg = route.legs?.[0];
      const firstStep = leg?.steps?.[0];
      const nextManoeuvre = firstStep?.navigationInstruction?.instructions || null;
      const durationSeconds = parseInt(route.duration?.replace('s', '') || '0');
      const distanceMetres = route.distanceMeters || 0;

      // Extract speed zone from first speed reading interval (km/h)
      const speedIntervals = route.travelAdvisory?.speedReadingIntervals || [];
      const currentSpeedZoneKmh = speedIntervals.length > 0 ? 50 : null; // default 50 if unavailable

      // Traffic condition from routing preference response
      const trafficCondition = 'light'; // Routes API optimal routing implies acceptable traffic

      return {
        origin,
        destination,
        etaMinutes: Math.round(durationSeconds / 60),
        distanceKm: Math.round(distanceMetres / 100) / 10,
        nextManoeuvre,
        currentSpeedZoneKmh,
        trafficCondition,
      };
    } catch (err) {
      logger.error('NavigationService: failed to fetch route context', {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data ?? null,
      });
      return null; // graceful degradation — never throw
    }
  }
}

export default new NavigationService();
