/**
 * @file server.test.ts
 * @description Comprehensive unit and integration tests for the cloud scraper and server.
 */

import "./mockFetch.ts";
import { describe, test, expect, beforeAll } from "bun:test";
import { initialLoadPromise } from "./mockFetch.ts";
import server from "../server/main.ts";
import { REGIONS } from "../server/regions.ts";
import type { Region } from "../server/regions.ts";
import { testLatency, scrapeIncidents } from "../server/scraper.ts";
import type { LatencyData, Incident } from "../server/scraper.ts";

describe("Cloud Latency Monitor", () => {
  beforeAll(async () => {
    // Wait for the initial background updateData() to finish all fetches.
    await initialLoadPromise;
    
    // Allow any remaining microtasks in the background updateData promise chain to resolve
    // so that cachedLatency is populated.
    let attempts = 0;
    const getLatencyLength = async () => {
      const res = await server.fetch(new Request("http://localhost/api/latency"));
      const data = (await res.json()) as unknown; // type guard to extract length safely
      if (Array.isArray(data)) {
        return data.length;
      }
      return 0;
    };
    
    while (attempts < 20 && (await getLatencyLength()) === 0) {
      await Promise.resolve();
      attempts++;
    }
  });

  describe("testLatency behavior", () => {
    test("when a mock fetch succeeds, records real latency", async () => {
      // Save original performance.now to restore later
      const originalPerformanceNow = performance.now;
      
      let nowCalls = 0;
      // Stub performance.now to return deterministic values
      performance.now = () => {
        nowCalls++;
        return nowCalls === 1 ? 200 : 275; // calculates to 75ms latency
      };

      try {
        const mockRegion: Region = {
          id: "us-east-1",
          provider: "aws",
          name: "AWS US East (N. Virginia)",
          lat: 38.0293,
          lon: -78.4767,
          pingUrl: "https://dynamodb.us-east-1.amazonaws.com",
          baseLatency: 15,
        };

        const successFetch = (async () => {
          return {
            text: async () => "success response",
          } as unknown as Response; // mock Response object for testing
        }) as unknown as typeof fetch; // mock fetch function for testing

        const result = await testLatency(mockRegion, successFetch);

        expect(result.regionId).toBe("us-east-1");
        expect(result.latency).toBe(75); // 275 - 200
        expect(result.isSimulated).toBe(false);
        expect(result.status).toBe("healthy");
      } finally {
        performance.now = originalPerformanceNow;
      }
    });

    test("when a mock fetch fails, falls back to simulated latency close to baseLatency", async () => {
      const mockRegion: Region = {
        id: "us-east-1",
        provider: "aws",
        name: "AWS US East (N. Virginia)",
        lat: 38.0293,
        lon: -78.4767,
        pingUrl: "https://dynamodb.us-east-1.amazonaws.com",
        baseLatency: 15,
      };

      const failingFetch = (async () => {
        throw new Error("DNS / connection failed");
      }) as unknown as typeof fetch; // mock fetch function for testing

      const result = await testLatency(mockRegion, failingFetch);

      expect(result.regionId).toBe("us-east-1");
      expect(result.isSimulated).toBe(true);
      
      // simulated latency should be within baseLatency +/- 10% (13.5 to 16.5, rounded to integers 14 to 17)
      const minExpected = Math.round(mockRegion.baseLatency * 0.9);
      const maxExpected = Math.round(mockRegion.baseLatency * 1.1);
      expect(result.latency).toBeGreaterThanOrEqual(minExpected);
      expect(result.latency).toBeLessThanOrEqual(maxExpected);
    });
  });

  describe("scrapeIncidents XML parsing", () => {
    test("successfully parses AWS, GCP, and Azure feeds, matches regions, and excludes resolved GCP incidents", async () => {
      const mockFetch = (async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : (input instanceof Request ? input.url : input.toString());

        if (url.includes("status.aws.amazon.com")) {
          return {
            text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Amazon Web Services Service Status</title>
    <item>
      <title><![CDATA[Service Disruption - Amazon Elastic Compute Cloud (N. Virginia)]]></title>
      <description><![CDATA[We are experiencing increased API error rates for EC2 in us-east-1.]]></description>
      <guid isPermaLink="false">us-east-1-ec2-12345</guid>
      <pubDate>Wed, 08 Jul 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Performance Issues - Amazon Simple Storage Service (Oregon)</title>
      <description>We are investigating latency in us-west-2.</description>
      <guid>us-west-2-s3-67890</guid>
      <pubDate>Wed, 08 Jul 2026 12:05:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
          } as unknown as Response; // mock Response object for testing
        }

        if (url.includes("status.cloud.google.com")) {
          return {
            text: async () => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Google Cloud Storage Service Disruption in Iowa</title>
    <id>gcp-gcs-12345</id>
    <content type="html">We are seeing errors with Cloud Storage in us-central1.</content>
    <updated>2026-07-08T12:00:00Z</updated>
    <link href="https://status.cloud.google.com/incidents/gcp-gcs-12345"/>
  </entry>
  <entry>
    <title>RESOLVED: Cloud Pub/Sub Issues in Belgium</title>
    <id>gcp-pubsub-67890</id>
    <content type="html">Resolved: Issues with Cloud Pub/Sub in europe-west1 have been resolved.</content>
    <updated>2026-07-08T12:10:00Z</updated>
    <link href="https://status.cloud.google.com/incidents/gcp-pubsub-67890"/>
  </entry>
</feed>`,
          } as unknown as Response; // mock Response object for testing
        }

        if (url.includes("status.azure.com")) {
          return {
            text: async () => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Azure Status</title>
    <item>
      <title>Virtual Machines - East US - Warning</title>
      <description><![CDATA[Customers using Virtual Machines in East US (Virginia) may experience connectivity issues.]]></description>
      <guid>azure-vm-eastus-12345</guid>
      <pubDate>Wed, 08 Jul 2026 12:00:00 GMT</pubDate>
      <link>https://status.azure.com/incidents/azure-vm-eastus-12345</link>
    </item>
  </channel>
</rss>`,
          } as unknown as Response; // mock Response object for testing
        }

        throw new Error(`Unexpected fetch URL in test: ${url}`);
      }) as unknown as typeof fetch; // mock fetch function for testing

      const incidents = await scrapeIncidents(mockFetch);

      // Verify incident count (2 AWS active, 1 GCP active, 1 Azure active. The resolved GCP one is excluded).
      expect(incidents.length).toBe(4);

      // AWS critical incident (disruption)
      const awsEc2 = incidents.find((i) => i.id === "us-east-1-ec2-12345");
      expect(awsEc2).toBeDefined();
      expect(awsEc2!.provider).toBe("aws");
      expect(awsEc2!.title).toBe("Service Disruption - Amazon Elastic Compute Cloud (N. Virginia)");
      expect(awsEc2!.description).toBe("We are experiencing increased API error rates for EC2 in us-east-1.");
      expect(awsEc2!.severity).toBe("critical");
      expect(awsEc2!.affectedRegions).toContain("us-east-1");

      // AWS warning incident (performance)
      const awsS3 = incidents.find((i) => i.id === "us-west-2-s3-67890");
      expect(awsS3).toBeDefined();
      expect(awsS3!.provider).toBe("aws");
      expect(awsS3!.title).toBe("Performance Issues - Amazon Simple Storage Service (Oregon)");
      expect(awsS3!.severity).toBe("warning");
      expect(awsS3!.affectedRegions).toContain("us-west-2");

      // GCP active incident
      const gcpStorage = incidents.find((i) => i.id === "gcp-gcs-12345");
      expect(gcpStorage).toBeDefined();
      expect(gcpStorage!.provider).toBe("gcp");
      expect(gcpStorage!.title).toBe("Google Cloud Storage Service Disruption in Iowa");
      expect(gcpStorage!.severity).toBe("critical");
      expect(gcpStorage!.affectedRegions).toContain("us-central1");

      // GCP resolved incident must be excluded
      const gcpResolved = incidents.find((i) => i.id === "gcp-pubsub-67890");
      expect(gcpResolved).toBeUndefined();

      // Azure incident
      const azureVm = incidents.find((i) => i.id === "azure-vm-eastus-12345");
      expect(azureVm).toBeDefined();
      expect(azureVm!.provider).toBe("azure");
      expect(azureVm!.title).toBe("Virtual Machines - East US - Warning");
      expect(azureVm!.severity).toBe("warning");
      expect(azureVm!.affectedRegions).toContain("eastus");
    });
  });

  describe("Server API endpoints", () => {
    test("GET /api/regions returns list of regions", async () => {
      const res = await server.fetch(new Request("http://localhost/api/regions"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      
      const data = (await res.json()) as unknown; // type guard to validate array shape
      expect(Array.isArray(data)).toBe(true);
      const regionsList = data as Region[];
      expect(regionsList.length).toBe(REGIONS.length);
      expect(regionsList[0].id).toBeDefined();
      expect(regionsList[0].provider).toBeDefined();
    });

    test("GET /api/latency returns latency data array", async () => {
      const res = await server.fetch(new Request("http://localhost/api/latency"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      
      const data = (await res.json()) as unknown; // type guard to validate latency array shape
      expect(Array.isArray(data)).toBe(true);
      const latencyList = data as LatencyData[];
      expect(latencyList.length).toBe(REGIONS.length);
      expect(latencyList[0].regionId).toBeDefined();
      expect(latencyList[0].latency).toBeDefined();
      expect(latencyList[0].status).toBeDefined();
      expect(latencyList[0].isSimulated).toBeDefined();
    });

    test("GET /api/incidents returns incidents array with matched regions", async () => {
      const res = await server.fetch(new Request("http://localhost/api/incidents"));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      
      const data = (await res.json()) as unknown; // type guard to validate incidents array shape
      expect(Array.isArray(data)).toBe(true);
      const incidentList = data as Incident[];
      // The mock initialization feed results should be present
      expect(incidentList.length).toBe(4);
      
      const awsEc2 = incidentList.find((i) => i.id === "us-east-1-ec2-12345");
      expect(awsEc2).toBeDefined();
      expect(awsEc2!.affectedRegions).toContain("us-east-1");
    });

    test("POST /api/ping triggers update and returns status", async () => {
      const res = await server.fetch(new Request("http://localhost/api/ping", { method: "POST" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      
      const data = (await res.json()) as unknown; // type guard to check status response
      expect(data && typeof data === "object" && "status" in data).toBe(true);
      const statusObj = data as { status: string };
      expect(statusObj.status).toBe("refreshing");
    });

    test("OPTIONS preflight requests return CORS headers", async () => {
      const res = await server.fetch(new Request("http://localhost/api/regions", { method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    });

    test("Returns 404 for unknown endpoints", async () => {
      const res = await server.fetch(new Request("http://localhost/api/nonexistent"));
      expect(res.status).toBe(404);
      const data = (await res.json()) as unknown; // type guard to validate error shape
      expect(data && typeof data === "object" && "error" in data).toBe(true);
      const errorObj = data as { error: string };
      expect(errorObj.error).toBe("not found");
    });
  });
});
