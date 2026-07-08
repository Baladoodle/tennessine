/**
 * @file main.ts
 * @description Frontend application coordinator.
 * initializes the 3D globe and UI overlays, establishes sync callbacks,
 * and maintains the periodic fetch loops to retrieve live metrics from the api.
 */

import { LatencyGlobe } from "./globe.ts";
import type { GlobeRegion } from "./globe.ts";
import { UIManager } from "./ui.ts";
  import type { Incident, LatencyData } from "../server/scraper.ts";
  import type { Region } from "../server/regions.ts";

// constants
const POLL_INTERVAL_MS = 5000; // fetch live updates every 5 seconds

// local state
let regionsBase: Region[] = [];
let latencyCache: LatencyData[] = [];
let incidentsCache: Incident[] = [];

// instantiate components
const ui = new UIManager();
const canvasContainer = document.getElementById("canvas-container")!;
const isInitiallyDark = document.documentElement.classList.contains("dark");
const globe = new LatencyGlobe(canvasContainer, isInitiallyDark);

/**
 * combines static region configurations with live latency measurements.
 */
function assembleGlobeRegions(): GlobeRegion[] {
  return regionsBase.map((region) => {
    const liveData = latencyCache.find(l => l.regionId === region.id);
    
    return {
      id: region.id,
      provider: region.provider,
      name: region.name,
      lat: region.lat,
      lon: region.lon,
      latency: liveData ? liveData.latency : 0,
      status: liveData ? liveData.status : "healthy",
      isSimulated: liveData ? liveData.isSimulated : true,
    };
  });
}

/**
 * fetches live statistics from the backend server.
 */
async function fetchUpdate() {
  try {
    const [latRes, incRes] = await Promise.all([
      fetch("/api/latency"),
      fetch("/api/incidents"),
    ]);

    if (!latRes.ok || !incRes.ok) {
      throw new Error("server response failed");
    }

    latencyCache = await latRes.json();
    incidentsCache = await incRes.json();

    const merged = assembleGlobeRegions();
    
    // update components in lockstep
    ui.updateData(merged, incidentsCache);
    globe.updateRegions(merged);
  } catch (error) {
    // fail silently to prevent console spam
  }
}

/**
 * manual trigger to ping the backend to run latency scans.
 */
async function triggerPingRefresh() {
  try {
    const res = await fetch("/api/ping", { method: "POST" });
    if (!res.ok) {
      throw new Error("ping command rejected");
    }
    // trigger immediate local fetch
    await fetchUpdate();
  } catch (error) {
    // quiet fail
  }
}

/**
 * establishes interactive linkage between components.
 */
function wireSync() {
  // sync selection from globe to list and card
  globe.setCallbacks(
    (regionId) => {
      ui.selectRegion(regionId);
    },
    (hoveredId) => {
      // scroll list row into view on hover
      if (hoveredId) {
        const rows = document.querySelectorAll("#regions-list > div");
        rows.forEach((row) => {
          const rowId = row.querySelector(".text-\\[10px\\]")?.textContent;
          if (rowId === hoveredId) {
            row.classList.add("bg-slate-100/60", "dark:bg-zinc-800/50");
          } else {
            row.classList.remove("bg-slate-100/60", "dark:bg-zinc-800/50");
          }
        });
      } else {
        const rows = document.querySelectorAll("#regions-list > div");
        rows.forEach((row) => {
          row.classList.remove("bg-slate-100/60", "dark:bg-zinc-800/50");
        });
      }
    }
  );

  // sync interaction from list to globe
  ui.setCallbacks(
    (regionId) => {
      globe.selectRegion(regionId);
    },
    () => {
      triggerPingRefresh();
    },
    (isDark) => {
      globe.setTheme(isDark);
    }
  );
}

/**
 * main application setup logic.
 */
async function main() {
  try {
    // 1. retrieve regions baseline first
    const regionsRes = await fetch("/api/regions");
    if (!regionsRes.ok) {
      throw new Error("could not load baseline region metadata");
    }
    regionsBase = await regionsRes.json();

    // 2. wire up interactive synchronization
    wireSync();

    // 3. fetch initial live dataset
    await fetchUpdate();

    // 4. default select the first region in the database
    if (regionsBase.length > 0) {
      const defaultId = regionsBase[0].id;
      ui.selectRegion(defaultId);
      globe.selectRegion(defaultId);
    }

    // 5. begin periodic updates
    setInterval(fetchUpdate, POLL_INTERVAL_MS);
  } catch (error) {
    // fallback if server is unreachable
    console.error("initialization failed:", error);
  }
}

// start app
main();
