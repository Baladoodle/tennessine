/**
 * vercel serverless function — returns the static list of cloud regions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { REGIONS } from "../server/regions.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");

  if (_req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return res.status(200).json(REGIONS);
}
