import { loadEnv, parseCities, callWaqiApi, sendJson } from "../server/apiHelper.js";

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
  const names = parseCities(url.searchParams.get("feeds")) || parseCities(process.env.CITY_LIST) || [];

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
    sendJson(response, 500, { error: error.message ?? "Unable to load AQI data." });
  }
}
