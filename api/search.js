import { loadEnv, callWaqiSearch, sendJson } from "../server/apiHelper.js";

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
  const keyword = url.searchParams.get("keyword")?.trim() || "";

  if (!keyword) {
    sendJson(response, 200, { results: [] });
    return;
  }

  try {
    const results = await callWaqiSearch(keyword);
    sendJson(response, 200, { results });
  } catch (error) {
    sendJson(response, 500, { error: error.message ?? "Unable to search cities." });
  }
}
