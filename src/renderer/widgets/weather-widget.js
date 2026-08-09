export class WeatherWidget {
  constructor() {
    console.log(
      "Creating WeatherWidget instance at:",
      new Date().toLocaleTimeString(),
    );

    // Access the storage helper from the global scope
    this.storage = window.storage;

    this.loadingEl = document.getElementById("weather-loading");
    this.locationEl = document.getElementById("weather-location");
    this.tempEl = document.getElementById("weather-temp");
    this.descEl = document.getElementById("weather-description");
    this.feelsLikeEl = document.getElementById("weather-feels-like");
    this.humidityEl = document.getElementById("weather-humidity");
    this.windEl = document.getElementById("weather-wind");

    console.log("Weather elements found:", {
      loading: !!this.loadingEl,
      location: !!this.locationEl,
      temp: !!this.tempEl,
      desc: !!this.descEl,
    });

    if (!this.locationEl) {
      console.error("Critical weather widget elements not found!");
      return;
    }

    this.init();
  }

  async init() {
    try {
      if (this.loadingEl) {
        this.loadingEl.style.display = "block";
        this.loadingEl.textContent = "Loading weather...";
      }

      // Small delay to prevent immediate API rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Add overall timeout for the entire weather loading process
      const weatherPromise = this.loadWeatherData();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Weather loading timeout")), 25000); // 25 second timeout to allow fallback
      });

      await Promise.race([weatherPromise, timeoutPromise]);
    } catch (error) {
      console.error("Weather widget init error:", error);
      // Provide user-friendly error messages
      let userMessage = "Weather service temporarily unavailable";
      if (error.message.includes("timeout")) {
        userMessage = "Weather loading timed out";
      } else if (error.message.includes("JSON")) {
        userMessage = "Weather data format error";
      } else if (
        error.message.includes("network") ||
        error.message.includes("fetch")
      ) {
        userMessage = "Unable to connect to weather service";
      } else if (error.message.includes("location")) {
        userMessage = "Location not available";
      }
      this.showError(userMessage);
    }
  }

  async loadWeatherData() {
    console.log("Starting weather data load...");

    console.log("Step 1: Getting location...");
    const position = await this.getLocationForWeather();
    console.log("Step 1 complete: Position obtained:", position);

    console.log("Step 2: Fetching weather...");
    const weather = await this.fetchWeather(
      position.latitude,
      position.longitude,
      position.customName,
    );
    console.log("Step 2 complete: Weather data obtained:", weather);

    console.log("Step 3: Getting location name...");
    const locationName =
      position.customName ||
      (await this.getLocationName(position.latitude, position.longitude));
    console.log("Step 3 complete: Location name obtained:", locationName);

    console.log("Step 4: Updating display...");
    this.updateDisplay(weather, locationName);
    console.log("Step 4 complete: Weather widget loaded successfully");
  }

  async getLocationForWeather() {
    console.log("=== GETTING WEATHER LOCATION ===");
    let storedCoords = null;
    try {
      // Check if manual location is enabled and set
      const useAutoLocation = await this.storage.getItem("useAutoLocation");
      const customLocation = await this.storage.getItem("weatherLocation");
      storedCoords = await this.storage.getItem("weatherCoords");

      console.log("Weather location check:");
      console.log("- useAutoLocation:", useAutoLocation);
      console.log("- customLocation:", customLocation);
      console.log("- storedCoords:", storedCoords);

      if (
        useAutoLocation === "false" &&
        customLocation &&
        customLocation.trim()
      ) {
        console.log("✓ Using manual weather location:", customLocation);

        // Use stored coordinates if available, otherwise geocode
        if (storedCoords) {
          try {
            const coords = JSON.parse(storedCoords);
            console.log("✓ Using stored coordinates:", coords);
            return {
              latitude: coords.lat,
              longitude: coords.lon,
              customName: customLocation,
            };
          } catch (parseError) {
            console.warn(
              "Failed to parse stored coordinates, geocoding instead",
            );
          }
        }

        // Fallback to geocoding if no stored coordinates
        console.log("⚠ Geocoding location:", customLocation);
        const coordinates = await this.geocodeLocation(customLocation);
        // Store the geocoded coordinates for future use
        await this.storage.setItem(
          "weatherCoords",
          JSON.stringify({
            lat: coordinates.latitude,
            lon: coordinates.longitude,
          }),
        );
        console.log("✓ Geocoded and stored coordinates:", coordinates);
        return { ...coordinates, customName: customLocation };
      }

      // Use automatic location detection
      console.log("⚠ Using automatic location detection");
      return await this.getCurrentLocation(storedCoords);
    } catch (error) {
      console.error("Error getting weather location:", error);
      // Fallback to automatic location
      return await this.getCurrentLocation(storedCoords);
    }
  }

  async geocodeLocation(locationName) {
    try {
      console.log("Geocoding location with Nominatim:", locationName);
      // Using Nominatim (OpenStreetMap) geocoding API - completely free
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`,
      );
      const data = await response.json();
      console.log("Geocoding response:", data);

      if (data && data.length > 0) {
        const result = data[0];
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
        };
      } else {
        throw new Error("Location not found");
      }
    } catch (error) {
      console.error("Geocoding failed for location:", locationName, error);
      throw new Error(`Unable to find coordinates for "${locationName}"`);
    }
  }

  getCurrentLocation(storedCoords = null) {
    return new Promise((resolve, reject) => {
      const useLastLocation = () => {
        if (storedCoords) {
          try {
            const coords = JSON.parse(storedCoords);
            if (Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
              resolve({ latitude: coords.lat, longitude: coords.lon });
              return true;
            }
          } catch (_error) {}
        }
        return false;
      };
      if (!navigator.geolocation) {
        if (!useLastLocation()) reject(new Error("Geolocation not supported"));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          this.storage.setItem("weatherCoords", JSON.stringify({
            lat: coordinates.latitude,
            lon: coordinates.longitude,
          })).catch(() => {});
          resolve(coordinates);
        },
        (error) => {
          console.warn("Geolocation failed, using the last known weather location");
          if (!useLastLocation()) resolve({ latitude: 51.5074, longitude: -0.1278 });
        },
        { timeout: 10000 },
      );
    });
  }

  async fetchWeather(lat, lon, customLocationName = null) {
    console.log(
      `Fetching weather for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}`,
    );

    // Try primary API first, then fallback APIs
    const apis = [
      () => this.fetchFromWttr(lat, lon, customLocationName),
      () => this.fetchFromOpenMeteo(lat, lon, customLocationName),
    ];

    let lastError = null;

    for (let i = 0; i < apis.length; i++) {
      try {
        console.log(`Trying weather API ${i + 1}/${apis.length}...`);
        const result = await apis[i]();
        console.log(`Weather API ${i + 1} succeeded!`);
        return result;
      } catch (error) {
        console.warn(`Weather API ${i + 1} failed:`, error.message);
        lastError = error;
        if (i < apis.length - 1) {
          console.log("Trying next API...");
          // Small delay between API attempts
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    // If all APIs failed, throw the last error
    throw new Error(
      `All weather APIs failed. Last error: ${lastError.message}`,
    );
  }

  async fetchFromWttr(lat, lon, customLocationName = null, retryCount = 0) {
    console.log(
      `Fetching from wttr.in for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}, attempt: ${retryCount + 1}`,
    );

    try {
      // Using wttr.in API - completely free, no API key needed
      const url = `https://wttr.in/${lat},${lon}?format=j1`;
      console.log("Wttr.in API URL:", url);

      // Add delay between requests to avoid rate limiting
      if (retryCount > 0) {
        const delay = 500; // Just 500ms delay
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      console.log("Making fetch request to wttr.in...");

      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout for wttr.in

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "VortexBrowser/1.0",
        },
      });

      clearTimeout(timeoutId);

      console.log("Wttr.in fetch completed. Response status:", response.status);

      if (!response.ok) {
        throw new Error(
          `Wttr.in API request failed with status ${response.status}`,
        );
      }

      // Get response text first to see what we're actually getting
      const responseText = await response.text();
      console.log("Wttr.in response text length:", responseText.length);

      if (!responseText || responseText.trim().length === 0) {
        throw new Error("Wttr.in API returned empty response");
      }

      // Check for rate limiting message
      if (responseText.includes("This query is already being processed")) {
        console.log("Wttr.in API rate limit detected, retrying...");
        if (retryCount < 1) {
          // Only 1 retry for wttr.in since we have fallback
          return await this.fetchFromWttr(lat, lon, retryCount + 1);
        } else {
          throw new Error("Wttr.in API is overloaded");
        }
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Wttr.in JSON parse error:", parseError);
        if (
          responseText.includes("This query is already being processed") &&
          retryCount < 1
        ) {
          return await this.fetchFromWttr(lat, lon, retryCount + 1);
        }
        throw new Error("Wttr.in API returned invalid JSON");
      }

      // Validate data structure
      if (!data.current_condition || !data.current_condition[0]) {
        throw new Error("Wttr.in API response missing current conditions");
      }

      // Transform wttr.in data to match our expected format
      const current = data.current_condition[0];
      const transformedData = {
        current: {
          temperature_2m: parseFloat(current.temp_C),
          apparent_temperature: parseFloat(current.FeelsLikeC),
          relative_humidity_2m: parseFloat(current.humidity),
          wind_speed_10m: parseFloat(current.windspeedKmph),
          weather_code: this.mapWttrCodeToOurCode(current.weatherCode),
        },
        location: {
          name:
            customLocationName ||
            data.nearest_area[0]?.areaName[0]?.value ||
            "Unknown",
          country: data.nearest_area[0]?.country[0]?.value || "",
        },
      };

      console.log("Wttr.in transformed weather data:", transformedData);
      return transformedData;
    } catch (error) {
      console.error("Wttr.in fetch error:", error);
      throw error;
    }
  }

  async fetchFromOpenMeteo(lat, lon, customLocationName = null) {
    console.log(
      `Fetching from Open-Meteo for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}`,
    );

    try {
      // Using Open-Meteo API - free and reliable
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius&wind_speed_unit=kmh`;
      console.log("Open-Meteo API URL:", url);

      console.log("Making fetch request to Open-Meteo...");

      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "VortexBrowser/1.0",
        },
      });

      clearTimeout(timeoutId);

      console.log(
        "Open-Meteo fetch completed. Response status:",
        response.status,
      );

      if (!response.ok) {
        throw new Error(
          `Open-Meteo API request failed with status ${response.status}`,
        );
      }

      const responseText = await response.text();
      console.log("Open-Meteo response text length:", responseText.length);

      if (!responseText || responseText.trim().length === 0) {
        throw new Error("Open-Meteo API returned empty response");
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Open-Meteo JSON parse error:", parseError);
        throw new Error("Open-Meteo API returned invalid JSON");
      }

      // Validate data structure for Open-Meteo API
      if (!data.current_weather) {
        throw new Error("Open-Meteo API response missing current weather data");
      }

      // Transform Open-Meteo data to match our expected format
      const current = data.current_weather;
      const transformedData = {
        current: {
          temperature_2m: parseFloat(current.temperature),
          apparent_temperature: parseFloat(current.temperature), // Open-Meteo doesn't have feels-like in basic API
          relative_humidity_2m: 50, // Default value since not available in basic API
          wind_speed_10m: parseFloat(current.windspeed),
          weather_code: this.mapOpenMeteoCodeToOurCode(current.weathercode),
        },
        location: {
          name: customLocationName || "Current Location", // Use custom location name if provided
          country: "",
        },
      };

      console.log("Open-Meteo transformed weather data:", transformedData);
      return transformedData;
    } catch (error) {
      console.error("Open-Meteo fetch error:", error);
      throw error;
    }
  }

  mapWttrCodeToOurCode(wttrCode) {
    // Map wttr.in weather codes to our simplified codes
    const code = parseInt(wttrCode);
    if ([200, 201, 202, 210, 211, 212, 221, 230, 231, 232].includes(code))
      return 95; // Thunderstorm
    if ([300, 301, 302, 310, 311, 312, 313, 314, 321].includes(code)) return 61; // Drizzle
    if ([500, 501, 502, 503, 504, 511, 520, 521, 522, 531].includes(code))
      return 63; // Rain
    if ([600, 601, 602, 611, 612, 613, 615, 616, 620, 621, 622].includes(code))
      return 71; // Snow
    if ([701, 711, 721, 731, 741, 751, 761, 762, 771, 781].includes(code))
      return 45; // Fog/Mist
    if (code === 800) return 0; // Clear
    if ([801, 802, 803, 804].includes(code)) return 3; // Clouds
    return 0; // Default to clear
  }

  mapOpenMeteoCodeToOurCode(weatherCode) {
    // Map Open-Meteo weather codes to our simplified codes
    const code = parseInt(weatherCode);
    switch (code) {
      case 0:
        return 0; // Clear sky
      case 1:
      case 2:
      case 3:
        return code; // Mainly clear, partly cloudy, overcast
      case 45:
      case 48:
        return 45; // Fog
      case 51:
      case 53:
      case 55:
        return 61; // Drizzle
      case 56:
      case 57:
        return 61; // Freezing drizzle
      case 61:
      case 63:
      case 65:
        return code; // Rain (slight, moderate, heavy)
      case 66:
      case 67:
        return 63; // Freezing rain
      case 71:
      case 73:
      case 75:
        return code; // Snow (slight, moderate, heavy)
      case 77:
        return 71; // Snow grains
      case 80:
      case 81:
      case 82:
        return 63; // Rain showers
      case 85:
      case 86:
        return 75; // Snow showers
      case 95:
        return 95; // Thunderstorm
      case 96:
      case 99:
        return 95; // Thunderstorm with hail
      default:
        return 0; // Default to clear
    }
  }

  async getLocationName(lat, lon) {
    // OpenWeatherMap already provides location name, so we don't need reverse geocoding
    return "Location";
  }

  getWeatherDescription(code) {
    const weatherCodes = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Depositing rime fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Dense drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      71: "Slight snow",
      73: "Moderate snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Slight rain showers",
      81: "Moderate rain showers",
      82: "Violent rain showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with hail",
      99: "Thunderstorm with heavy hail",
    };

    return weatherCodes[code] || "Unknown";
  }

  updateDisplay(weather, locationName) {
    console.log("Updating weather display with:", { weather, locationName });

    if (this.loadingEl) {
      this.loadingEl.style.display = "none";
    }

    const current = weather.current;

    // Use location from weather data if available, otherwise use provided name
    const displayLocation = weather.location
      ? `${weather.location.name}, ${weather.location.country}`
      : locationName;

    if (this.locationEl) this.locationEl.textContent = displayLocation;
    if (this.tempEl)
      this.tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    if (this.descEl)
      this.descEl.textContent = this.getWeatherDescription(
        current.weather_code,
      );
    if (this.feelsLikeEl)
      this.feelsLikeEl.textContent = `Feels like: ${Math.round(current.apparent_temperature)}°C`;
    if (this.humidityEl)
      this.humidityEl.textContent = `Humidity: ${current.relative_humidity_2m}%`;
    if (this.windEl)
      this.windEl.textContent = `Wind: ${Math.round(current.wind_speed_10m)} km/h`;

    console.log("Weather display updated successfully");
  }

  showError(errorMessage = "Unable to load weather data") {
    console.log("Showing weather error:", errorMessage);
    if (this.loadingEl) this.loadingEl.style.display = "none";

    if (this.locationEl) this.locationEl.textContent = "Weather Unavailable";
    if (this.tempEl) this.tempEl.textContent = "--°C";
    if (this.descEl) this.descEl.textContent = errorMessage;
    if (this.feelsLikeEl) this.feelsLikeEl.textContent = "Feels like: --°C";
    if (this.humidityEl) this.humidityEl.textContent = "Humidity: --%";
    if (this.windEl) this.windEl.textContent = "Wind: -- km/h";
  }
}
