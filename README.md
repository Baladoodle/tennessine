# Tennessine Cloud Latency Globe

Interactive 3D network topology globe visualizing real-time latency and status updates scraped from AWS, GCP, and Azure.

## Prerequisites

- [Bun](https://bun.sh) (v1.0.0 or higher)

## Installation

Install the project dependencies:

```bash
bun install
```

## Running the Application

1. **Start the API Server** (runs on port 3000):
   ```bash
   bun run server
   ```

2. **Start the Frontend Development Server** (runs on port 5173, with proxy to the API):
   ```bash
   bun run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`.

## Production Build

To build and run the application in production mode:

1. **Build the assets**:
   ```bash
   bun run build
   ```

2. **Start the server** in production mode:
   ```bash
   NODE_ENV=production bun run server
   ```

3. Open your browser and navigate to `http://localhost:3000`.

## Running Tests

To run the unit and integration tests:

```bash
bun test
```
