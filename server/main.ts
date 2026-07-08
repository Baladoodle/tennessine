/**
 * @file main.ts
 * @description Entrypoint for the bun backend server.
 * handles the api endpoints and schedules periodic scraping background tasks.
 */

import { serve } from "bun";
import { REGIONS } from "./regions.ts";
import { testLatency, scrapeIncidents, type LatencyData, type Incident } from "./scraper.ts";

// constants configuration
const PORT = process.env.PORT || 3000;
const LATENCY_REFRESH_MS = 15000; // test latency every 15 seconds
const FEED_REFRESH_MS = 60000; // scrape feeds every minute

// in-memory caches
let cachedLatency: LatencyData[] = [];
let cachedIncidents: Incident[] = [];
let isUpdating = false;

/**
 * performs latency checks and scrapes status feeds.
 * updates the local caches concurrently.
 */
async function updateData() {
  if (isUpdating) {
    return;
  }
  isUpdating = true;

  try {
    // scrape active incidents first to know region health status
    cachedIncidents = await scrapeIncidents();

    // test region latencies in parallel
    const latencyPromises = REGIONS.map(async (region) => {
      const data = await testLatency(region);

      // check if any active incident affects this region
      const hasOutage = cachedIncidents.some(
        incident => incident.affectedRegions.includes(region.id) && incident.severity === "critical"
      );
      const hasWarning = cachedIncidents.some(
        incident => incident.affectedRegions.includes(region.id) && incident.severity === "warning"
      );

      if (hasOutage) {
        data.status = "outage";
      } else if (hasWarning) {
        data.status = "degraded";
      } else {
        data.status = "healthy";
      }

      return data;
    });

    cachedLatency = await Promise.all(latencyPromises);
  } catch (error) {
    // catch-all block to prevent server crashes
  } finally {
    isUpdating = false;
  }
}

// perform initial load on startup without blocking
updateData();

// start background timers
setInterval(updateData, LATENCY_REFRESH_MS);
setInterval(async () => {
  try {
    cachedIncidents = await scrapeIncidents();
  } catch (error) {
    // fail silently
  }
}, FEED_REFRESH_MS);

// launch bun http server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*", // allow local testing across ports
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };

    // handle options preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // api endpoints
    if (url.pathname === "/api/regions") {
      return new Response(JSON.stringify(REGIONS), { headers });
    }

    if (url.pathname === "/api/latency") {
      return new Response(JSON.stringify(cachedLatency), { headers });
    }

    if (url.pathname === "/api/incidents") {
      return new Response(JSON.stringify(cachedIncidents), { headers });
    }

    if (url.pathname === "/api/ping" && req.method === "POST") {
      // trigger background update
      updateData();
      return new Response(JSON.stringify({ status: "refreshing" }), { headers });
    }

    // serve production build assets
    if (process.env.NODE_ENV === "production") {
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(`./dist${filePath}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers,
    });
  },
});

console.log(`Server listening on port ${server.port}`);
export default server;
