import { loadEnv, parseCities, sendJson, smsTemplates } from "../server/apiHelper.js";

export default async function handler(request, response) {
  loadEnv();

  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  sendJson(response, 200, {
    defaultCities: parseCities(process.env.CITY_LIST) || [],
    defaultPhone: process.env.DEFAULT_ALERT_PHONE || "",
    smsTemplates,
    smsEnabled: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER,
    ),
    waqiTokenConfigured: Boolean(process.env.WAQI_API_TOKEN?.trim()),
    waqiUsingDemoToken: process.env.WAQI_API_TOKEN?.trim() === "demo",
  });
}
