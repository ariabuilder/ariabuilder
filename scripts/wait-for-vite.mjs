const url = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:1420/";
const deadline = Date.now() + 30_000;

while (Date.now() < deadline) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.ok || response.status === 304) {
      process.exit(0);
    }
  } catch {
    // Vite is still starting.
  } finally {
    clearTimeout(timeout);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

console.error(`Timed out waiting for Vite at ${url}`);
process.exit(1);
