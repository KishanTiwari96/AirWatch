import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const viteDevPort = 5173;
const fallbackApiPort = 8787;

loadEnvFile(path.join(rootDir, ".env"));

const requestedPort = Number(
  process.env.SERVER_PORT?.trim() || process.env.API_PORT?.trim() || process.env.PORT?.trim() || fallbackApiPort,
);
const port =
  requestedPort === viteDevPort
    ? fallbackApiPort
    : Number.isFinite(requestedPort) && requestedPort > 0
      ? requestedPort
      : fallbackApiPort;
const waqiToken = process.env.WAQI_API_TOKEN?.trim() || "";
const defaultCities = parseCities(process.env.CITY_LIST) || [];
const smsTemplates = {
  safety: {
    en: "Air Pollution Alert: Wear N95 mask, stay indoors, keep windows closed, drink water, and check AQI. Avoid outdoor exercise, smoking, and ignoring breathing problems.",
    hi: "वायु प्रदूषण अलर्ट: N95 मास्क पहनें, घर के अंदर रहें, खिड़कियां बंद रखें, पानी पिएं और AQI जांचें। बाहर व्यायाम, धूम्रपान और सांस की दिक्कत को नजरअंदाज न करें।",
  },
};
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const source = readFileSync(filePath, "utf8");

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseCities(rawValue) {
  if (!rawValue) {
    return null;
  }

  return rawValue
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function resolveSmsMessage(payload) {
  const directMessage = typeof payload?.body === "string" ? payload.body.trim() : "";

  if (directMessage) {
    return directMessage;
  }

  const templateName = typeof payload?.template === "string" ? payload.template.trim().toLowerCase() : "";
  const language = typeof payload?.language === "string" ? payload.language.trim().toLowerCase() : "en";

  if (!templateName) {
    return "";
  }

  return smsTemplates[templateName]?.[language] ?? "";
}

function sendJson(response, statusCode, payload) {
  applyCorsHeaders(response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function applyCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function normalizeNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFeed(payload) {
  return {
    aqi: normalizeNumeric(payload?.aqi),
    attribution: payload?.attributions?.[0]?.name ?? "World Air Quality Index Project",
    city: payload?.city?.name ?? "Unknown area",
    coordinates: payload?.city?.geo ?? null,
    dominantPollutant: payload?.dominentpol ?? null,
    pollutants: {
      co: normalizeNumeric(payload?.iaqi?.co?.v),
      no2: normalizeNumeric(payload?.iaqi?.no2?.v),
      o3: normalizeNumeric(payload?.iaqi?.o3?.v),
      pm10: normalizeNumeric(payload?.iaqi?.pm10?.v),
      pm25: normalizeNumeric(payload?.iaqi?.pm25?.v),
      so2: normalizeNumeric(payload?.iaqi?.so2?.v),
    },
    timeStamp: payload?.time?.iso ?? payload?.time?.s ?? null,
    url: payload?.city?.url ?? null,
    weather: {
      humidity: normalizeNumeric(payload?.iaqi?.h?.v),
      pressure: normalizeNumeric(payload?.iaqi?.p?.v),
      temperature: normalizeNumeric(payload?.iaqi?.t?.v),
      wind: normalizeNumeric(payload?.iaqi?.w?.v),
    },
  };
}

async function callWaqiApi(endpoint) {
  if (!waqiToken) {
    throw new Error("WAQI_API_TOKEN is missing. Add your WAQI token to .env.");
  }

  const targetUrl = `https://api.waqi.info${endpoint}${endpoint.includes("?") ? "&" : "?"}token=${encodeURIComponent(waqiToken)}`;
  const upstreamResponse = await fetch(targetUrl, {
    headers: {
      "User-Agent": "AirWatch/1.0",
    },
  });

  if (!upstreamResponse.ok) {
    throw new Error(`WAQI request failed with status ${upstreamResponse.status}.`);
  }

  const payload = await upstreamResponse.json();

  if (payload.status !== "ok") {
    throw new Error(typeof payload.data === "string" ? payload.data : "AQI data unavailable.");
  }

  return normalizeFeed(payload.data);
}

async function callWaqiSearch(keyword) {
  if (!waqiToken) {
    throw new Error("WAQI_API_TOKEN is missing. Add your WAQI token to .env.");
  }

  const targetUrl = `https://api.waqi.info/search/?keyword=${encodeURIComponent(keyword)}&token=${encodeURIComponent(waqiToken)}`;
  const upstreamResponse = await fetch(targetUrl, {
    headers: {
      "User-Agent": "AirWatch/1.0",
    },
  });

  if (!upstreamResponse.ok) {
    throw new Error(`WAQI search failed with status ${upstreamResponse.status}.`);
  }

  const payload = await upstreamResponse.json();

  if (payload.status !== "ok") {
    throw new Error(typeof payload.data === "string" ? payload.data : "Unable to search cities.");
  }

  return (payload.data || []).slice(0, 8).map((item) => ({
    aqi: normalizeNumeric(item?.aqi),
    city: item?.station?.name ?? "Unknown station",
    feed: item?.uid ? `@${item.uid}` : item?.station?.name ?? "",
    timeStamp: item?.time?.stime ?? null,
    uid: item?.uid ?? null,
    coordinates: item?.station?.geo ?? null,
  }));
}

function isValidPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

async function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;

      if (rawBody.length > 100_000) {
        reject(new Error("Payload too large."));
      }
    });

    request.on("end", () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

async function sendSmsAlert({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    const error = new Error("Twilio is not configured. Add credentials to .env.");
    error.statusCode = 400;
    throw error;
  }

  if (!isValidPhone(to)) {
    const error = new Error("Phone number must use E.164 format, like +15551234567.");
    error.statusCode = 400;
    throw error;
  }

  const payload = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    },
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = result?.message || `Twilio request failed with status ${response.status}.`;
    const error = new Error(message);
    error.statusCode =
      response.status === 400 || response.status === 401 || response.status === 403
        ? response.status
        : 502;
    error.details = result;
    throw error;
  }

  return {
    sid: result.sid,
    status: result.status,
  };
}

function serveStaticFile(requestPath, response) {
  if (!existsSync(distDir)) {
    sendJson(response, 200, {
      message:
        "AirWatch API is running. Build the React app with `npm run build` or use `npm run dev` for the frontend.",
    });
    return;
  }

  const sanitizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.join(distDir, sanitizedPath);

  if (!absolutePath.startsWith(distDir)) {
    sendJson(response, 403, { error: "Forbidden path." });
    return;
  }

  const filePath = existsSync(absolutePath) ? absolutePath : path.join(distDir, "index.html");
  const extension = path.extname(filePath);

  response.writeHead(200, {
    "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    applyCorsHeaders(response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(response, 200, {
      defaultCities,
      defaultPhone: process.env.DEFAULT_ALERT_PHONE || "",
      smsTemplates,
      smsEnabled: Boolean(
        process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
      ),
      waqiTokenConfigured: Boolean(waqiToken),
      waqiUsingDemoToken: waqiToken === "demo",
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/search") {
    const keyword = requestUrl.searchParams.get("keyword")?.trim();

    if (!keyword) {
      sendJson(response, 200, { results: [] });
      return;
    }

    try {
      const results = await callWaqiSearch(keyword);
      sendJson(response, 200, { results });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message ?? "Unable to search cities.",
      });
    }

    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/cities") {
    const names = parseCities(requestUrl.searchParams.get("feeds")) || defaultCities;

    try {
      const resultSet = await Promise.allSettled(
        names.map((city) => callWaqiApi(`/feed/${encodeURIComponent(city)}/`)),
      );
      const results = [];
      const errors = [];

      resultSet.forEach((result, index) => {
        if (result.status === "fulfilled") {
          results.push({
            ...result.value,
            requestedFeed: names[index],
          });
        } else {
          errors.push({
            city: names[index],
            error: result.reason?.message ?? "Unable to load AQI.",
          });
        }
      });

      sendJson(response, 200, {
        results,
        errors,
      });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message ?? "Unable to load AQI data.",
      });
    }

    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/location") {
    const latitude = normalizeNumeric(requestUrl.searchParams.get("lat"));
    const longitude = normalizeNumeric(requestUrl.searchParams.get("lon"));

    if (latitude === null || longitude === null) {
      sendJson(response, 400, {
        error: "Latitude and longitude are required.",
      });
      return;
    }

    try {
      const result = await callWaqiApi(`/feed/geo:${latitude};${longitude}/`);
      sendJson(response, 200, { result });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message ?? "Unable to load location AQI.",
      });
    }

    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/notify") {
    try {
      const body = await parseJsonBody(request);
      const message = resolveSmsMessage(body);
      const recipient = typeof body.to === "string" ? body.to.trim() : "";

      if (!message) {
        sendJson(response, 400, {
          error: "SMS body is required. Or send a valid template with template and language.",
        });
        return;
      }

      const result = await sendSmsAlert({
        to: recipient,
        body: message.slice(0, 320),
      });

      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message ?? "Unable to send SMS.",
      });
    }

    return;
  }

  serveStaticFile(requestUrl.pathname, response);
});

server.listen(port, () => {
  if (requestedPort === viteDevPort) {
    console.warn(
      "Ignoring port 5173 for the API server to avoid colliding with Vite. Using port 8787 instead.",
    );
  }
  console.log(`AirWatch server listening on http://localhost:${port}`);
});
