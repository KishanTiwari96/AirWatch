import { useEffect, useMemo, useRef, useState } from "react";
import {
  AQI_LEGEND,
  averageAqi,
  buildAlertMessage,
  compareBandSeverity,
  formatAqi,
  formatLocalTime,
  formatPollutantName,
  getAqiBand,
  getWorstLocation,
} from "./lib/aqi";

const STORAGE_KEYS = {
  trackedPlaces: "airwatch.tracked-places",
  alertSettings: "airwatch.alert-settings",
};

const DEFAULT_ALERT_SETTINGS = {
  enabled: true,
  phone: "",
  threshold: 100,
  minimumRise: 20,
  cooldownMinutes: 30,
};

const QUICK_START_SEARCHES = ["Delhi", "Mumbai", "London", "Singapore", "New York", "Tokyo"];
const SAFETY_DOS = [
  "Wear an N95 or KN95 mask before stepping outdoors when AQI is high.",
  "Stay indoors as much as possible and keep windows and doors closed.",
  "Drink water regularly and use an air purifier if one is available.",
  "Check the AQI before walks, school travel, or any outdoor plan.",
];
const SAFETY_DONTS = [
  "Do not jog, play hard sports, or do heavy exercise outside in polluted air.",
  "Do not let children, elderly family members, or asthma patients stay outside too long.",
  "Do not smoke or burn incense, trash, wood, or anything else indoors.",
  "Do not ignore coughing, wheezing, eye irritation, or breathing discomfort.",
];

function readStoredJson(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function migrateStoredPlaces(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return {
          feed: item,
          id: item.toLowerCase(),
          label: item,
        };
      }

      if (!item?.feed || !item?.id || !item?.label) {
        return null;
      }

      return {
        feed: item.feed,
        id: item.id,
        label: item.label,
      };
    })
    .filter(Boolean);
}

function toFixedCoordinate(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "--";
}

function haversineDistanceKm(from, to) {
  if (!from || !to) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusKm = 6371;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const latitudeA = (from.latitude * Math.PI) / 180;
  const latitudeB = (to.latitude * Math.PI) / 180;

  const arc =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function normalizePhone(value) {
  return value.replace(/[^\d+]/g, "");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

function makeTrackedPlace(item) {
  return {
    feed: item.feed,
    id: item.uid ? `station-${item.uid}` : item.feed.toLowerCase(),
    label: item.city,
  };
}

function getSmsReadiness({ config, alertSettings, locationTracking }) {
  if (!config?.smsEnabled) {
    return {
      label: "Server setup needed",
      detail: "Add Twilio credentials in .env and restart the backend.",
    };
  }

  if (!alertSettings.phone) {
    return {
      label: "Phone number needed",
      detail: "Enter the destination number in E.164 format to enable SMS delivery.",
    };
  }

  if (!alertSettings.enabled) {
    return {
      label: "Alerts paused",
      detail: "Turn on Enable alerts to allow automatic AQI messages.",
    };
  }

  if (!locationTracking) {
    return {
      label: "Tracking off",
      detail: "Use your location so the app can watch for AQI changes automatically.",
    };
  }

  return {
    label: "Ready for auto SMS",
    detail: "The next qualifying AQI reading can trigger a message to your saved number.",
  };
}

function getSidePanelMessage({ smsReadiness, locationReading, trackedPlaces }) {
  if (locationReading) {
    return {
      title: "Your live location is now part of the watch.",
      detail:
        "AirWatch is checking the air around you in real time and can warn you when the next reading becomes worse than your alert rules allow.",
    };
  }

  if (trackedPlaces.length) {
    return {
      title: "Your board is ready. Add live movement next.",
      detail:
        "You already have tracked places on the left. Turn on location access when you want the app to compare where you are now against your SMS alert settings.",
    };
  }

  if (smsReadiness.label === "Server setup needed") {
    return {
      title: "Finish setup, then this side becomes your alert radar.",
      detail:
        "Once Twilio and location tracking are enabled, this panel will show your current-place AQI and whether automatic SMS alerts are ready to fire.",
    };
  }

  return {
    title: "This side is your live alert radar.",
    detail:
      "It becomes useful after you turn on location tracking. Then it shows your current-place AQI, alert readiness, and whether the app can text you automatically.",
  };
}

function App() {
  const [config, setConfig] = useState(null);
  const [trackedPlaces, setTrackedPlaces] = useState(() =>
    migrateStoredPlaces(readStoredJson(STORAGE_KEYS.trackedPlaces, [])),
  );
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState("Search for any city or station.");
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [cityData, setCityData] = useState([]);
  const [cityErrors, setCityErrors] = useState([]);
  const [isCitiesLoading, setIsCitiesLoading] = useState(false);
  const [locationTracking, setLocationTracking] = useState(false);
  const [locationStatus, setLocationStatus] = useState("Location tracking is idle.");
  const [locationReading, setLocationReading] = useState(null);
  const [locationCoordinates, setLocationCoordinates] = useState(null);
  const [alertSettings, setAlertSettings] = useState(() =>
    readStoredJson(STORAGE_KEYS.alertSettings, DEFAULT_ALERT_SETTINGS),
  );
  const [alertHistory, setAlertHistory] = useState([]);
  const [smsStatus, setSmsStatus] = useState("SMS notifications are waiting for a trigger.");
  const [isSendingTestSms, setIsSendingTestSms] = useState(false);

  const locationWatchIdRef = useRef(null);
  const locationFetchMetaRef = useRef({ timestamp: 0, coordinates: null });
  const lastAlertRef = useRef({ timestamp: 0, aqi: null, city: null });

  useEffect(() => {
    fetchJson("/api/config")
      .then((payload) => {
        setConfig(payload);
        setAlertSettings((current) =>
          !current.phone && payload.defaultPhone
            ? { ...current, phone: payload.defaultPhone }
            : current,
        );
      })
      .catch(() => {
        setConfig({
          defaultCities: [],
          smsEnabled: false,
          waqiTokenConfigured: false,
          waqiUsingDemoToken: false,
        });
      });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.trackedPlaces, JSON.stringify(trackedPlaces));
  }, [trackedPlaces]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.alertSettings, JSON.stringify(alertSettings));
  }, [alertSettings]);

  useEffect(() => {
    const keyword = searchInput.trim();

    if (!keyword) {
      setSearchResults([]);
      setIsSearchLoading(false);
      setSearchStatus("Search for any city or station.");
      return undefined;
    }

    if (!config?.waqiTokenConfigured) {
      setSearchResults([]);
      setSearchStatus("Add your WAQI token in .env before searching cities.");
      return undefined;
    }

    let cancelled = false;
    setIsSearchLoading(true);
    setSearchStatus(`Searching for "${keyword}"...`);

    const timeoutId = window.setTimeout(async () => {
      try {
        const payload = await fetchJson(`/api/search?keyword=${encodeURIComponent(keyword)}`);

        if (cancelled) {
          return;
        }

        setSearchResults(payload.results ?? []);
        setSearchStatus(
          payload.results?.length
            ? "Select a result to add it to the dashboard."
            : "No matching city found yet.",
        );
      } catch (error) {
        if (!cancelled) {
          setSearchResults([]);
          setSearchStatus(error.message || "Unable to search cities.");
        }
      } finally {
        if (!cancelled) {
          setIsSearchLoading(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [config?.waqiTokenConfigured, searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadCities() {
      if (!trackedPlaces.length) {
        setCityData([]);
        setCityErrors([]);
        setIsCitiesLoading(false);
        return;
      }

      setIsCitiesLoading(true);

      try {
        const payload = await fetchJson(
          `/api/cities?feeds=${encodeURIComponent(trackedPlaces.map((item) => item.feed).join(","))}`,
        );

        if (cancelled) {
          return;
        }

        const mergedResults = (payload.results ?? []).map((entry) => {
          const match = trackedPlaces.find((item) => item.feed === entry.requestedFeed);

          return {
            ...entry,
            trackingId: match?.id ?? entry.city,
            trackingLabel: match?.label ?? entry.city,
          };
        });

        setCityData(mergedResults);
        setCityErrors(payload.errors ?? []);
      } catch (error) {
        if (!cancelled) {
          setCityErrors([{ city: "Dashboard", error: error.message }]);
        }
      } finally {
        if (!cancelled) {
          setIsCitiesLoading(false);
        }
      }
    }

    loadCities();
    const intervalId = window.setInterval(loadCities, 180000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [trackedPlaces]);

  useEffect(() => {
    if (!locationTracking || !navigator.geolocation) {
      return undefined;
    }

    async function refreshLocationAqi(position) {
      const nextCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const now = Date.now();
      const distanceTravelled = haversineDistanceKm(
        locationFetchMetaRef.current.coordinates,
        nextCoordinates,
      );

      if (distanceTravelled < 0.4 && now - locationFetchMetaRef.current.timestamp < 90000) {
        return;
      }

      locationFetchMetaRef.current = {
        timestamp: now,
        coordinates: nextCoordinates,
      };

      setLocationStatus("Checking live AQI near your current location...");
      setLocationCoordinates(nextCoordinates);

      try {
        const payload = await fetchJson(
          `/api/location?lat=${nextCoordinates.latitude}&lon=${nextCoordinates.longitude}`,
        );
        const nextReading = payload.result;

        setLocationReading((previousReading) => {
          void maybeSendAlert(nextReading, previousReading);
          return nextReading;
        });

        setLocationStatus(`Tracking ${nextReading.city} in real time.`);
      } catch (error) {
        setLocationStatus(error.message || "Unable to fetch nearby AQI.");
      }
    }

    async function maybeSendAlert(currentReading, previousReading) {
      if (!alertSettings.enabled || !alertSettings.phone || !config?.smsEnabled) {
        return;
      }

      const currentAqi = Number(currentReading?.aqi);
      const previousAqi = Number(previousReading?.aqi);
      const bandRise = compareBandSeverity(currentAqi, previousAqi);
      const isFirstReading = !previousReading;
      const crossedThreshold =
        Number.isFinite(currentAqi) &&
        currentAqi >= Number(alertSettings.threshold) &&
        (!Number.isFinite(previousAqi) || previousAqi < Number(alertSettings.threshold));
      const roseSharply =
        Number.isFinite(currentAqi) &&
        Number.isFinite(previousAqi) &&
        currentAqi - previousAqi >= Number(alertSettings.minimumRise);
      const cooldownMs = Number(alertSettings.cooldownMinutes) * 60000;
      const lastAlertAt = lastAlertRef.current.timestamp;
      const canNotifyAgain = Date.now() - lastAlertAt > cooldownMs;
      const movedIntoWorseAir = crossedThreshold || (!isFirstReading && (bandRise > 0 || roseSharply));

      if (!movedIntoWorseAir || !canNotifyAgain) {
        return;
      }

      const message = buildAlertMessage({
        current: currentReading,
        previous: previousReading,
      });

      try {
        setSmsStatus("Sending SMS alert...");
        const payload = await fetchJson("/api/notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: normalizePhone(alertSettings.phone),
            body: message,
          }),
        });

        lastAlertRef.current = {
          timestamp: Date.now(),
          aqi: currentAqi,
          city: currentReading.city,
        };

        setAlertHistory((current) => [
          {
            id: crypto.randomUUID(),
            city: currentReading.city,
            aqi: currentAqi,
            sentAt: new Date().toISOString(),
            sid: payload.sid,
          },
          ...current,
        ]);

        setSmsStatus(`SMS sent for ${currentReading.city} at AQI ${formatAqi(currentAqi)}.`);
      } catch (error) {
        setSmsStatus(error.message || "SMS failed to send.");
      }
    }

    locationWatchIdRef.current = navigator.geolocation.watchPosition(refreshLocationAqi, (error) => {
      setLocationStatus(error.message || "Location access was blocked.");
    });

    return () => {
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
        locationWatchIdRef.current = null;
      }
    };
  }, [alertSettings, config?.smsEnabled, locationTracking]);

  const averageCityAqi = useMemo(() => averageAqi(cityData), [cityData]);
  const worstLocation = useMemo(() => getWorstLocation(cityData), [cityData]);
  const locationBand = getAqiBand(locationReading?.aqi);
  const smsReadiness = getSmsReadiness({
    config,
    alertSettings,
    locationTracking,
  });
  const sidePanelMessage = getSidePanelMessage({
    smsReadiness,
    locationReading,
    trackedPlaces,
  });

  function addTrackedPlace(place) {
    setTrackedPlaces((current) => {
      if (current.some((item) => item.id === place.id || item.feed === place.feed)) {
        return current;
      }

      return [...current, place];
    });
    setSearchInput("");
    setSearchResults([]);
    setSearchStatus("Added to your live AQI board.");
  }

  function handleSearchSubmit(event) {
    event.preventDefault();

    const firstResult = searchResults[0];
    if (firstResult) {
      addTrackedPlace(makeTrackedPlace(firstResult));
    }
  }

  function removeTrackedPlace(placeId) {
    setTrackedPlaces((current) => current.filter((item) => item.id !== placeId));
  }

  function updateAlertSetting(key, value) {
    setAlertSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function triggerQuickSearch(term) {
    setSearchInput(term);
    setSearchStatus(`Searching for "${term}"...`);
  }

  async function sendTestSms() {
    try {
      setIsSendingTestSms(true);
      setSmsStatus("Sending test SMS...");
      await fetchJson("/api/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: normalizePhone(alertSettings.phone),
          body: "AirWatch test message: SMS alerts are configured and ready.",
        }),
      });
      setSmsStatus("Test SMS sent successfully.");
    } catch (error) {
      setSmsStatus(error.message || "Test SMS failed.");
    } finally {
      setIsSendingTestSms(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="shell-frame">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark">AW</span>
            <div>
              <p className="eyebrow">AirWatch</p>
              <strong className="brand-title">Live AQI monitoring with location-aware SMS</strong>
            </div>
          </div>
          <div className="topbar-meta">
            <div className="metric-chip">
              <span className="metric-label">Tracked</span>
              <strong>{trackedPlaces.length} places</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-label">Average AQI</span>
              <strong>{formatAqi(averageCityAqi)}</strong>
            </div>
            <div className="metric-chip">
              <span className="metric-label">Alerts</span>
              <strong>{smsReadiness.label}</strong>
            </div>
          </div>
        </header>

        <section className="masthead">
          <div className="masthead-copy">
            <p className="eyebrow">AQI Command Center</p>
            <h1>Track the cities you care about, watch air quality shift live, and get warned before conditions turn worse.</h1>
            <p>
              Search any city or station, build a live air-quality board, and connect automatic SMS
              alerts to your real location without leaving the same screen.
            </p>
            <div className="hero-brief">
              <div className="hero-brief-card">
                <span className="metric-label">What AirWatch helps with</span>
                <strong>See the risk fast, then act before the air gets worse.</strong>
                <p>
                  Track your key places, compare AQI at a glance, and keep simple safety guidance
                  close while live alerts watch for a sharper rise.
                </p>
              </div>
              <div className="hero-brief-points">
                <span>Live AQI board</span>
                <span>Location-aware alerts</span>
                <span>Simple safety guidance</span>
              </div>
            </div>
            <div className="hero-metrics">
              <div>
                <span className="metric-label">Worst place</span>
                <strong>{worstLocation?.trackingLabel ?? "Waiting..."}</strong>
              </div>
              <div>
                <span className="metric-label">Current threshold</span>
                <strong>{alertSettings.threshold}</strong>
              </div>
              <div>
                <span className="metric-label">Cooldown</span>
                <strong>{alertSettings.cooldownMinutes} min</strong>
              </div>
            </div>
          </div>

          <div className="masthead-side">
            <div className="side-note">
              <span className="status-pill">{smsReadiness.label}</span>
              <h3 className="side-title">{sidePanelMessage.title}</h3>
              <p className="side-copy">{sidePanelMessage.detail}</p>
            </div>
            <div className={`location-highlight band-${locationBand.key}`}>
              <span className="metric-label">Current location AQI</span>
              <strong>{formatAqi(locationReading?.aqi)}</strong>
              <p>{locationReading ? locationBand.label : "Location not active yet"}</p>
            </div>
          </div>
        </section>

        <section className="workspace-main">
          <div className="left-column">
            <article className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Discover</p>
                  <h2>Search and build your live board</h2>
                </div>
                <form className="city-form" onSubmit={handleSearchSubmit}>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Search city or station"
                    aria-label="Search city or station"
                  />
                  <button type="submit" disabled={!searchResults.length}>
                    Add first result
                  </button>
                </form>
              </div>

              <div className="search-spotlight">
                <div className="search-spotlight-copy">
                  <span className="metric-label">Discovery mode</span>
                  <h3>Start with search and shape the board around places you actually care about.</h3>
                  <p>
                    Every result you add becomes a live AQI card with health bands, pollutants, and
                    timing details. No preset clutter, just the places you choose.
                  </p>
                </div>
                <div className="search-spotlight-stats">
                  <div className="search-spotlight-stat">
                    <span className="metric-label">Board size</span>
                    <strong>{trackedPlaces.length}</strong>
                    <p>saved places</p>
                  </div>
                  <div className="search-spotlight-stat">
                    <span className="metric-label">Search results</span>
                    <strong>{searchResults.length}</strong>
                    <p>live matches</p>
                  </div>
                </div>
              </div>

              {!config?.waqiTokenConfigured ? (
                <p className="info-banner">
                  Add your WAQI token in `.env` to search and load real city AQI results.
                </p>
              ) : null}

              {config?.waqiUsingDemoToken ? (
                <p className="info-banner">
                  WAQI&apos;s demo token can return sample station data instead of the exact city you
                  request. Use your own token for reliable search results.
                </p>
              ) : null}

              <div className="search-panel">
                <div className="search-status-row">
                  <p className="status-copy">{isSearchLoading ? "Searching..." : searchStatus}</p>
                </div>

                <div className="quick-start-row">
                  {QUICK_START_SEARCHES.map((term) => (
                    <button
                      key={term}
                      type="button"
                      className="quick-start-chip"
                      onClick={() => triggerQuickSearch(term)}
                    >
                      {term}
                    </button>
                  ))}
                </div>

                {searchResults.length ? (
                  <div className="search-results">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.uid ?? result.feed}-${result.city}`}
                        type="button"
                        className="search-result"
                        onClick={() => addTrackedPlace(makeTrackedPlace(result))}
                      >
                        <div>
                          <strong>{result.city}</strong>
                          <span>{result.uid ? `Station ${result.uid}` : "Search result"}</span>
                        </div>
                        <div className={`search-aqi band-${getAqiBand(result.aqi).key}`}>
                          AQI {formatAqi(result.aqi)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : !searchInput ? (
                  <div className="search-empty-stage">
                    <article className="empty-stage-card empty-stage-primary">
                      <span className="metric-label">Start here</span>
                      <h3>Search one city and the empty wall becomes a real AQI dashboard.</h3>
                      <p>
                        Use the quick chips above or type a place manually. The board below fills
                        with live colour-graded cards as soon as you add a result.
                      </p>
                    </article>
                    <article className="empty-stage-card empty-stage-secondary">
                      <span className="metric-label">Best first check</span>
                      <strong>Pick a city you know well</strong>
                      <p>
                        It makes it easier to compare what you see in the app with the place you
                        already expect to be clean, moderate, or bad.
                      </p>
                    </article>
                  </div>
                ) : null}
              </div>
            </article>

            <article className="panel-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Board</p>
                  <h2>Your live AQI wall</h2>
                </div>
              </div>

              {isCitiesLoading ? <p className="loading-copy">Refreshing tracked AQI readings...</p> : null}

              {trackedPlaces.length ? (
                <div className="tracked-tags">
                  {trackedPlaces.map((place) => (
                    <button
                      key={place.id}
                      type="button"
                      className="tracked-tag"
                      onClick={() => removeTrackedPlace(place.id)}
                    >
                      {place.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="board-empty-shell">
                  <div className="board-empty-copy">
                    <p className="eyebrow">Live board</p>
                    <h3>Your tracked places will appear here.</h3>
                    <p className="empty-copy">
                      Add any search result and this area becomes your live AQI wall with instant
                      colour grading, station details, and update timing.
                    </p>
                  </div>
                  <div className="board-empty-preview">
                    <div className="preview-card preview-card-good">
                      <span>Good</span>
                      <strong>42</strong>
                    </div>
                    <div className="preview-card preview-card-moderate">
                      <span>Moderate</span>
                      <strong>88</strong>
                    </div>
                    <div className="preview-card preview-card-unhealthy">
                      <span>Unhealthy</span>
                      <strong>171</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="city-grid">
                {cityData.map((entry) => {
                  const band = getAqiBand(entry.aqi);

                  return (
                    <article key={entry.trackingId} className={`city-card band-${band.key}`}>
                      <div className="card-head">
                        <div>
                          <h3>{entry.trackingLabel}</h3>
                          <p>{band.label}</p>
                        </div>
                        <button
                          type="button"
                          className="chip-button"
                          onClick={() => removeTrackedPlace(entry.trackingId)}
                          aria-label={`Remove ${entry.trackingLabel}`}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="aqi-value">{formatAqi(entry.aqi)}</div>
                      <p className="band-summary">{band.summary}</p>
                      <dl className="detail-list">
                        <div>
                          <dt>Station</dt>
                          <dd>{entry.city}</dd>
                        </div>
                        <div>
                          <dt>Dominant pollutant</dt>
                          <dd>{formatPollutantName(entry.dominantPollutant)}</dd>
                        </div>
                        <div>
                          <dt>Updated</dt>
                          <dd>{formatLocalTime(entry.timeStamp)}</dd>
                        </div>
                        <div>
                          <dt>Humidity</dt>
                          <dd>{entry.weather?.humidity ?? "--"}%</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>

              {cityErrors.length ? (
                <div className="error-list">
                  {cityErrors.map((error) => (
                    <p key={`${error.city}-${error.error}`}>
                      {error.city}: {error.error}
                    </p>
                  ))}
                </div>
              ) : null}
            </article>

            <article className="guide-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Safety guide</p>
                  <h3>Air pollution do&apos;s and don&apos;ts</h3>
                </div>
              </div>

              <div className="safety-hero">
                <span className="status-pill safety-pill">Protect your lungs</span>
                <h4>When the air gets worse, reduce exposure first and strain later.</h4>
                <p>
                  This guide gives a person the simplest next actions to follow during poor air
                  quality, without mixing in app setup or Twilio instructions.
                </p>
              </div>

              <div className="drawer-stack">
                <details className="guide-drawer do-card" open>
                  <summary className="drawer-summary safety-summary">
                    <span className="guide-badge">Do</span>
                    <strong>Protective steps to follow</strong>
                  </summary>
                  <ul className="guide-list safety-list">
                    {SAFETY_DOS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>

                <details className="guide-drawer dont-card">
                  <summary className="drawer-summary safety-summary">
                    <span className="guide-badge">Do Not</span>
                    <strong>Things to avoid in polluted air</strong>
                  </summary>
                  <ul className="guide-list safety-list">
                    {SAFETY_DONTS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              </div>
            </article>
          </div>

          <div className="right-column">
            <article className="subpanel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Live movement</p>
                  <h3>Location-triggered alerts</h3>
                </div>
                <button
                  type="button"
                  className={`toggle-button ${locationTracking ? "active" : ""}`}
                  onClick={() => setLocationTracking((current) => !current)}
                >
                  {locationTracking ? "Pause tracking" : "Use my location"}
                </button>
              </div>

              <div className="tracker-card">
                <div className={`tracker-status band-${locationBand.key}`}>
                  <span className="metric-label">Status</span>
                  <strong>{locationReading?.city ?? "Awaiting permission"}</strong>
                  <p>{locationStatus}</p>
                </div>
                <div className="tracker-coordinates">
                  <div>
                    <span className="metric-label">Latitude</span>
                    <strong>{toFixedCoordinate(locationCoordinates?.latitude)}</strong>
                  </div>
                  <div>
                    <span className="metric-label">Longitude</span>
                    <strong>{toFixedCoordinate(locationCoordinates?.longitude)}</strong>
                  </div>
                </div>
              </div>
            </article>

            <article className="subpanel">
              <div className="settings-head">
                <div>
                  <p className="eyebrow">SMS setup</p>
                  <h3>Alert phone and rules</h3>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={alertSettings.enabled}
                    onChange={(event) => updateAlertSetting("enabled", event.target.checked)}
                  />
                  Enable alerts
                </label>
              </div>

              <div className="settings-grid">
                <label>
                  Phone number
                  <input
                    type="tel"
                    value={alertSettings.phone}
                    onChange={(event) => updateAlertSetting("phone", event.target.value)}
                    placeholder="+15551234567"
                  />
                </label>
                <label>
                  AQI threshold
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={alertSettings.threshold}
                    onChange={(event) => updateAlertSetting("threshold", Number(event.target.value))}
                  />
                </label>
                <label>
                  Minimum rise
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={alertSettings.minimumRise}
                    onChange={(event) =>
                      updateAlertSetting("minimumRise", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Cooldown (minutes)
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={alertSettings.cooldownMinutes}
                    onChange={(event) =>
                      updateAlertSetting("cooldownMinutes", Number(event.target.value))
                    }
                  />
                </label>
              </div>

              <div className="settings-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!alertSettings.phone || !config?.smsEnabled || isSendingTestSms}
                  onClick={() => void sendTestSms()}
                >
                  {isSendingTestSms ? "Sending..." : "Send test SMS"}
                </button>
              </div>

              <div className="readiness-card">
                <span className="metric-label">Automatic alert status</span>
                <strong>{smsReadiness.label}</strong>
                <p>{smsReadiness.detail}</p>
                <p className="readiness-rule">
                  First reading can send at AQI {alertSettings.threshold}+. Later readings also send
                  if AQI rises by {alertSettings.minimumRise}+ or moves into a worse band. Cooldown:
                  {" "}{alertSettings.cooldownMinutes} minutes.
                </p>
              </div>

              <p className="info-banner">
                Twilio SMS is {config?.smsEnabled ? "configured" : "not configured yet"} on the
                server. Save your phone in E.164 format and use the test button once before live
                alerts.
              </p>
              <p className="status-copy">{smsStatus}</p>
            </article>

            <article className="legend-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">AQI guide</p>
                  <h3>Colour legend</h3>
                </div>
              </div>
              <div className="legend-list">
                {AQI_LEGEND.map((band) => (
                  <div key={band.key} className={`legend-item band-${band.key}`}>
                    <strong>{band.label}</strong>
                    <span>
                      {band.min} - {band.max === Number.POSITIVE_INFINITY ? "500+" : band.max}
                    </span>
                  </div>
                ))}
              </div>
            </article>

            <article className="history-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">History</p>
                  <h3>Recent SMS events</h3>
                </div>
              </div>

              {alertHistory.length ? (
                <div className="history-list">
                  {alertHistory.map((entry) => (
                    <div key={entry.id} className="history-item">
                      <strong>{entry.city}</strong>
                      <span>AQI {formatAqi(entry.aqi)}</span>
                      <span>{formatLocalTime(entry.sentAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-copy">SMS alerts will appear here after the first trigger.</p>
              )}
            </article>
          </div>
        </section>

        <footer className="app-footer">
          <div className="footer-bar">
            <div className="footer-block">
              <p className="eyebrow">AirWatch</p>
              <p className="footer-copy">
                A cleaner AQI dashboard built around your own tracked places instead of fixed city
                clutter.
              </p>
            </div>
            <div className="footer-block">
              <span className="metric-label">Data</span>
              <p className="footer-copy">
                World Air Quality Index powers the readings. Twilio handles SMS delivery when your
                server is configured.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
