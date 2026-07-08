/**
 * vercel serverless function — tests latency to all cloud regions on each request.
 * no in-memory cache since serverless functions are stateless.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { REGIONS } from "../server/regions";
import { testLatency, scrapeIncidents } from "../server/scraper";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=10, s-maxage=10");

  if (_req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // scrape incidents to determine region health status
    const incidents = await scrapeIncidents();

    // test all regions in parallel
    const latencyData = await Promise.all(
      REGIONS.map(async (region) => {
        const data = await testLatency(region);

        const hasOutage = incidents.some(
          (inc) => inc.affectedRegions.includes(region.id) && inc.severity === "critical"
        );
        const hasWarning = incidents.some(
          (inc) => inc.affectedRegions.includes(region.id) && inc.severity === "warning"
        );

        if (hasOutage) {
          data.status = "outage";
        } else if (hasWarning) {
          data.status = "degraded";
        }

        return data;
      })
    );

    return res.status(200).json(latencyData);
  } catch (error) {
    return res.status(500).json({ error: "failed to fetch latency data" });
  }
}
