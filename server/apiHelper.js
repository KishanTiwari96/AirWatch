import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

export const smsTemplates = {
  safety: {
    en: "Air Pollution Alert: Wear N95 mask, stay indoors, keep windows closed, drink water, and check AQI. Avoid outdoor exercise, smoking, and ignoring breathing problems.",
    hi: "वायु प्रदूषण अलर्ट: N95 मास्क पहनें, घर के अंदर रहें, खिड़कियां बंद रखें, पानी पिएं और AQI जांचें। बाहर व्यायाम, धूम्रपान और सांस की दिक्कत को नजरअंदाज न करें।",
  },
};

export function resolveSmsMessage(payload) {
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

export function loadEnv() {
  loadEnvFile(join(rootDir, ".env"));
}

export function parseCities(rawValue) {
  if (!rawValue) {
    return null;
  }

  return rawValue
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function applyCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

export function sendJson(response, statusCode, payload) {
  applyCorsHeaders(response);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function normalizeNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeFeed(payload) {
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

export async function callWaqiApi(endpoint) {
  const waqiToken = process.env.WAQI_API_TOKEN?.trim() || "";
  if (!waqiToken) {
    throw new Error("WAQI_API_TOKEN is missing. Add your WAQI token to environment variables.");
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

export async function callWaqiSearch(keyword) {
  const waqiToken = process.env.WAQI_API_TOKEN?.trim() || "";
  if (!waqiToken) {
    throw new Error("WAQI_API_TOKEN is missing. Add your WAQI token to environment variables.");
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

export function isValidPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export async function parseJsonBody(request) {
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

export async function sendSmsAlert({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    const error = new Error("Twilio is not configured. Add credentials to environment variables.");
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
