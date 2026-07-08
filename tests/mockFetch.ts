/**
 * @file mockFetch.ts
 * @description Mocks the global fetch function for testing the cloud scraper and server.
 */

import { REGIONS } from "../server/regions.ts";

export const awsMockXml = `<?xml version="1.0" encoding="UTF-8"?>
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
</rss>`;

export const gcpMockXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Google Cloud Status Feed</title>
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
</feed>`;

export const azureMockXml = `<?xml version="1.0" encoding="utf-8"?>
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
</rss>`;

let fetchCount = 0;
const expectedFetches = 3 + REGIONS.length;
export const { promise: initialLoadPromise, resolve: resolveInitialLoad } = Promise.withResolvers<void>();

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : (input instanceof Request ? input.url : input.toString());
  
  fetchCount++;
  if (fetchCount === expectedFetches) {
    resolveInitialLoad();
  }

  if (url.includes("status.aws.amazon.com")) {
    return {
      text: async () => awsMockXml,
    } as unknown as Response; // mock Response object for testing
  }
  
  if (url.includes("status.cloud.google.com")) {
    return {
      text: async () => gcpMockXml,
    } as unknown as Response; // mock Response object for testing
  }
  
  if (url.includes("status.azure.com")) {
    return {
      text: async () => azureMockXml,
    } as unknown as Response; // mock Response object for testing
  }
  
  // latency ping url response
  return {
    text: async () => "ok",
  } as unknown as Response; // mock Response object for testing
}) as typeof fetch;
