import { loadEnv, callWaqiApi, normalizeNumeric, sendJson } from "../server/apiHelper.js";

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

  const url = new URL(request.url, "http://localhost");
  const latitude = normalizeNumeric(url.searchParams.get("lat"));
  const longitude = normalizeNumeric(url.searchParams.get("lon"));

  if (latitude === null || longitude === null) {
    sendJson(response, 400, { error: "Latitude and longitude are required." });
    return;
  }

  try {
    const result = await callWaqiApi(`/feed/geo:${latitude};${longitude}/`);
    sendJson(response, 200, { result });
  } catch (error) {
    sendJson(response, 500, { error: error.message ?? "Unable to load location AQI." });
  }
}
