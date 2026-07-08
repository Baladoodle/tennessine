/**
 * vercel serverless function — scrapes cloud provider status feeds on each request.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { scrapeIncidents } from "../server/scraper.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");

  if (_req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const incidents = await scrapeIncidents();
    return res.status(200).json(incidents);
  } catch (error) {
    return res.status(500).json({ error: "failed to scrape incidents" });
  }
}
