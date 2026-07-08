/**
 * @file scraper.ts
 * @description Cloud latency tester and status feed scraper.
 * fetches real-time latency and pulls RSS status feeds from cloud providers.
 */

import { REGIONS, type Region } from "./regions.js";

export interface LatencyData {
  regionId: string;
  latency: number;
  status: "healthy" | "degraded" | "outage";
  isSimulated: boolean;
  timestamp: number;
}

export interface Incident {
  id: string;
  provider: "aws" | "gcp" | "azure";
  title: string;
  description: string;
  link: string;
  timestamp: number;
  affectedRegions: string[];
  severity: "warning" | "critical";
}

/**
 * matches text against a region configuration to see if it is affected.
 * checks for the region id or name keywords in the description or title.
 */
function matchRegion(text: string, region: Region): boolean {
  const content = text.toLowerCase();
  
  // check direct id match
  if (content.includes(region.id.toLowerCase())) {
    return true;
  }

  // check provider-specific keywords
  const keywords: Record<string, string[]> = {
    "us-east-1": ["virginia", "us-east-1"],
    "us-west-2": ["oregon", "us-west-2"],
    "eu-west-1": ["ireland", "eu-west-1"],
    "eu-central-1": ["frankfurt", "eu-central-1"],
    "ap-northeast-1": ["tokyo", "ap-northeast-1"],
    "ap-southeast-1": ["singapore", "ap-southeast-1"],
    "ap-southeast-2": ["sydney", "ap-southeast-2"],
    "sa-east-1": ["sao paulo", "sa-east-1", "são paulo"],
    "af-south-1": ["cape town", "af-south-1"],
    "me-central-1": ["uae", "me-central-1", "middle east"],
    
    "us-east1": ["south carolina", "us-east1"],
    "us-central1": ["iowa", "us-central1"],
    "us-west1": ["oregon", "us-west1"],
    "europe-west1": ["belgium", "europe-west1"],
    "europe-west3": ["frankfurt", "europe-west3"],
    "asia-east1": ["taiwan", "asia-east1"],
    "asia-northeast1": ["tokyo", "asia-northeast1"],
    "asia-southeast1": ["singapore", "asia-southeast1"],
    "australia-southeast1": ["sydney", "australia-southeast1"],
    "southamerica-east1": ["sao paulo", "southamerica-east1", "são paulo"],

    "eastus": ["virginia", "eastus"],
    "westus2": ["washington", "westus2"],
    "northeurope": ["ireland", "northeurope"],
    "westeurope": ["netherlands", "westeurope", "amsterdam"],
    "japaneast": ["tokyo", "japaneast"],
    "southeastasia": ["singapore", "southeastasia"],
    "australiaeast": ["sydney", "australiaeast"],
    "brazilsouth": ["sao paulo", "brazilsouth", "são paulo"],
    "southafricanorth": ["johannesburg", "southafricanorth"]
  };

  const list = keywords[region.id];
  if (!list) {
    return false;
  }

  return list.some(keyword => content.includes(keyword));
}

/**
 * tests the network latency to a single region.
 * if the fetch fails, falls back to a simulated latency with randomized jitter.
 */
export async function testLatency(
  region: Region,
  fetchFn: typeof fetch = fetch
): Promise<LatencyData> {
  const start = performance.now();
  let isSimulated = false;
  let latency = 0;
  
  try {
    // using HEAD request with a short timeout to save bandwidth
    const response = await fetchFn(region.pingUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    
    // ensure we consumed the response headers
    await response.text();
    latency = Math.round(performance.now() - start);
  } catch (error) {
    // network or dns failure fallback to simulated values
    isSimulated = true;
    const jitter = (Math.random() - 0.5) * 2 * 0.1; // +/- 10% jitter
    latency = Math.round(region.baseLatency * (1 + jitter));
  }

  return {
    regionId: region.id,
    latency,
    status: "healthy", // status is updated by feed results
    isSimulated,
    timestamp: Date.now(),
  };
}

/**
 * scrapes status rss and atom feeds from AWS, GCP, and Azure.
 * parses xml feed entries using regex.
 */
export async function scrapeIncidents(
  fetchFn: typeof fetch = fetch
): Promise<Incident[]> {
  const incidents: Incident[] = [];
  const timeout = 4000;

  // AWS Scraper
  try {
    const response = await fetchFn("https://status.aws.amazon.com/rss/all.rss", {
      signal: AbortSignal.timeout(timeout),
    });
    const xml = await response.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    
    for (const item of items) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/);
      const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/) || item.match(/<guid.*?>(.*?)<\/guid>/);
      const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

      const title = titleMatch ? titleMatch[1].trim() : "AWS Service Disruption";
      const description = descMatch ? descMatch[1].trim() : "";
      const guid = guidMatch ? guidMatch[1].trim() : Math.random().toString(36).substring(7);
      const dateStr = pubDateMatch ? pubDateMatch[1] : "";
      const timestamp = dateStr ? new Date(dateStr).getTime() : Date.now();

      // match regions
      const searchContext = `${title} ${description} ${guid}`;
      const affectedRegions = REGIONS
        .filter(r => r.provider === "aws" && matchRegion(searchContext, r))
        .map(r => r.id);

      const severity = title.toLowerCase().includes("disruption") || description.toLowerCase().includes("unable")
        ? "critical"
        : "warning";

      incidents.push({
        id: guid,
        provider: "aws",
        title,
        description,
        link: "https://status.aws.amazon.com/",
        timestamp,
        affectedRegions,
        severity,
      });
    }
  } catch (error) {
    // quiet fail
  }

  // GCP Scraper
  try {
    const response = await fetchFn("https://status.cloud.google.com/feed.atom", {
      signal: AbortSignal.timeout(timeout),
    });
    const xml = await response.text();
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

    for (const entry of entries) {
      const titleMatch = entry.match(/<title>(.*?)<\/title>/);
      const idMatch = entry.match(/<id>(.*?)<\/id>/);
      const contentMatch = entry.match(/<content.*?>([\s\S]*?)<\/content>/);
      const updatedMatch = entry.match(/<updated>(.*?)<\/updated>/);
      const linkMatch = entry.match(/<link href="(.*?)"/);

      const title = titleMatch ? titleMatch[1].trim() : "GCP Incident";
      const description = contentMatch ? contentMatch[1].trim().replace(/<[^>]*>/g, "") : "";
      const id = idMatch ? idMatch[1].trim() : Math.random().toString(36).substring(7);
      const dateStr = updatedMatch ? updatedMatch[1] : "";
      const timestamp = dateStr ? new Date(dateStr).getTime() : Date.now();
      const link = linkMatch ? linkMatch[1] : "https://status.cloud.google.com/";

      const searchContext = `${title} ${description} ${id}`;
      const affectedRegions = REGIONS
        .filter(r => r.provider === "gcp" && matchRegion(searchContext, r))
        .map(r => r.id);

      // check if it is resolved or active
      const isResolved = title.startsWith("RESOLVED:");
      if (isResolved) {
        continue; // only track active incidents on the live map
      }

      const severity = title.toLowerCase().includes("disruption") || description.toLowerCase().includes("outage")
        ? "critical"
        : "warning";

      incidents.push({
        id,
        provider: "gcp",
        title,
        description,
        link,
        timestamp,
        affectedRegions,
        severity,
      });
    }
  } catch (error) {
    // quiet fail
  }

  // Azure Scraper
  try {
    const response = await fetchFn("https://status.azure.com/en-us/status/feed/", {
      signal: AbortSignal.timeout(timeout),
    });
    const xml = await response.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const item of items) {
      const titleMatch = item.match(/<title>(.*?)<\/title>/);
      const descMatch = item.match(/<description>(.*?)<\/description>/);
      const guidMatch = item.match(/<guid.*?>(.*?)<\/guid>/);
      const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);

      const title = titleMatch ? titleMatch[1].trim() : "Azure Incident";
      const description = descMatch ? descMatch[1].trim().replace(/<[^>]*>/g, "") : "";
      const id = guidMatch ? guidMatch[1].trim() : Math.random().toString(36).substring(7);
      const dateStr = pubDateMatch ? pubDateMatch[1] : "";
      const timestamp = dateStr ? new Date(dateStr).getTime() : Date.now();
      const link = linkMatch ? linkMatch[1] : "https://status.azure.com/";

      const searchContext = `${title} ${description} ${id}`;
      const affectedRegions = REGIONS
        .filter(r => r.provider === "azure" && matchRegion(searchContext, r))
        .map(r => r.id);

      const severity = title.toLowerCase().includes("outage") || description.toLowerCase().includes("disruption")
        ? "critical"
        : "warning";

      incidents.push({
        id,
        provider: "azure",
        title,
        description,
        link,
        timestamp,
        affectedRegions,
        severity,
      });
    }
  } catch (error) {
    // quiet fail
  }

  return incidents;
}
