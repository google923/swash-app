/**
 * weather-forecast.js
 * Fetches weather data for a given week using Open-Meteo free API
 * No API key required - uses user's current location or defaults to UK
 */

// Cache for weather data (key: week ISO date)
const weatherCache = new Map();
const CACHE_TTL = 3600000; // 1 hour
const FORECAST_LOOKAHEAD_LIMIT_DAYS = 16; // Open-Meteo free forecast limit
const HISTORICAL_LOOKBACK_LIMIT_DAYS = 7; // Avoid heavy archive requests for far past weeks

// User's location (will be set via geolocation)
let userLat = 53.4808;  // Default: Manchester
let userLong = -2.2426;
let locationResolved = false;

/**
 * Get user's current location via geolocation API
 */
async function getUserLocation() {
  if (locationResolved) {
    return { lat: userLat, long: userLong };
  }

  return new Promise((resolve) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          userLat = position.coords.latitude;
          userLong = position.coords.longitude;
          locationResolved = true;
          console.log(`[Weather] Using user location: ${userLat}, ${userLong}`);
          resolve({ lat: userLat, long: userLong });
        },
        (error) => {
          console.warn("[Weather] Geolocation denied, using default location:", error);
          locationResolved = true;
          resolve({ lat: userLat, long: userLong });
        }
      );
    } else {
      console.warn("[Weather] Geolocation not available, using default location");
      locationResolved = true;
      resolve({ lat: userLat, long: userLong });
    }
  });
}

/**
 * Fetch weather forecast for a given week
 * @param {Date} weekStartDate - Start of week (Monday)
 * @returns {Promise<Object>} Weather data with rain/temp info
 */
export async function fetchWeatherForWeek(weekStartDate) {
  try {
    const weekKey = toIsoDate(weekStartDate);
    
    // Check cache
    if (weatherCache.has(weekKey)) {
      const cached = weatherCache.get(weekKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Weather] Using cached forecast for ${weekKey}`);
        return cached.data;
      }
    }

    // Get user location
    const location = await getUserLocation();

    const today = new Date();
    const diffDays = Math.round((weekStartDate - today) / 86400000);

    // Gracefully skip weeks outside the forecast window to avoid API 400s
    if (diffDays > FORECAST_LOOKAHEAD_LIMIT_DAYS) {
      const data = buildUnavailableWeather(`Forecast available ${FORECAST_LOOKAHEAD_LIMIT_DAYS} days before start`);
      weatherCache.set(weekKey, { data, timestamp: Date.now() });
      console.info(`[Weather] Skipping fetch for ${weekKey} – beyond forecast range`);
      return data;
    }

    if (diffDays < -HISTORICAL_LOOKBACK_LIMIT_DAYS) {
      const data = buildUnavailableWeather("Forecast not available for this past week");
      weatherCache.set(weekKey, { data, timestamp: Date.now() });
      console.info(`[Weather] Skipping fetch for ${weekKey} – outside historical window`);
      return data;
    }

    // Fetch from Open-Meteo Forecast API (works for future dates)
    const weekEnd = addDays(weekStartDate, 6);
    const startStr = toIsoDate(weekStartDate);
    const endStr = toIsoDate(weekEnd);

    // Use forecast API for current/future dates
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.long}&start_date=${startStr}&end_date=${endStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&temperature_unit=celsius&timezone=UTC`;

    console.log(`[Weather] Fetching forecast for week ${weekKey} at ${location.lat.toFixed(2)}, ${location.long.toFixed(2)}`);
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 400) {
        const data = buildUnavailableWeather("Forecast unavailable for this range");
        weatherCache.set(weekKey, { data, timestamp: Date.now() });
        console.warn(`[Weather] Forecast request rejected for ${weekKey} (400)`);
        return data;
      }
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const weatherData = parseWeatherData(data, weekStartDate);

    // Cache the result
    weatherCache.set(weekKey, {
      data: weatherData,
      timestamp: Date.now(),
    });

    return weatherData;
  } catch (error) {
    console.error("[Weather] Failed to fetch weather data:", error);
    return buildUnavailableWeather("Unable to load weather");
  }
}

function buildUnavailableWeather(message) {
  return {
    avgTemp: message,
    rainDays: [],
    precipitation: 0,
    weatherSummary: message,
    hasRain: false,
    icon: "ℹ️",
  };
}

/**
 * Parse Open-Meteo response into user-friendly format
 */
function parseWeatherData(apiData, weekStartDate) {
  const daily = apiData.daily;
  const temps = daily.temperature_2m_max;
  const precip = daily.precipitation_sum;  // Changed from precipitation to precipitation_sum
  const codes = daily.weather_code;

  // Calculate average temp
  const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
  const totalPrecip = precip.reduce((a, b) => a + b, 0);

  // Find days with rain (precipitation > 0.5mm or weather code indicates rain)
  const rainDays = [];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  
  codes.forEach((code, idx) => {
    if (precip[idx] > 0.5 || isRainyCode(code)) {
      rainDays.push({
        day: dayNames[idx],
        precipitation: precip[idx],
        weatherCode: code,
      });
    }
  });

  // Generate summary
  let weatherSummary = `Avg: ${avgTemp}°C`;
  
  if (rainDays.length > 0) {
    const rainDaysList = rainDays.map((d) => d.day).join(", ");
    weatherSummary += ` • Rain: ${rainDaysList}`;
  } else {
    weatherSummary += " • No rain expected";
  }

  return {
    avgTemp: `${avgTemp}°C`,
    rainDays,
    precipitation: totalPrecip,
    weatherSummary,
    hasRain: rainDays.length > 0,
    icon: rainDays.length > 0 ? "🌧️" : "☀️",
  };
}

/**
 * Check if weather code indicates rain/precipitation
 * WMO Weather interpretation codes
 */
function isRainyCode(code) {
  // Codes 51-67 = drizzle/rain
  // Codes 80-82 = rain showers
  // Codes 85-86 = snow showers
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 85 && code <= 86);
}

/**
 * Get day name from index
 */
function getDayName(index) {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return days[index];
}

/**
 * Convert date to ISO string (YYYY-MM-DD)
 */
function toIsoDate(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Add days to a date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
