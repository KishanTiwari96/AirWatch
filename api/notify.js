import { loadEnv, parseJsonBody, resolveSmsMessage, sendSmsAlert, sendJson } from "../server/apiHelper.js";

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

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

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
}
