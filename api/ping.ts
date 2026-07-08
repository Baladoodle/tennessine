/**
 * vercel serverless function — acknowledges a refresh request.
 * in serverless there is no persistent cache to invalidate;
 * the next latency/incidents call fetches fresh data automatically.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (_req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return res.status(200).json({ status: "refreshing" });
}
