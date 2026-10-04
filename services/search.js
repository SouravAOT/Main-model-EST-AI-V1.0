const DEFAULT_TIMEOUT = 12000;

export async function searchWeb(query, options = {}) {
  const baseUrl = process.env.SEARXNG_URL;

  if (!baseUrl) {
    throw new Error("SEARXNG_URL is not configured.");
  }

  const cleanQuery = String(query || "").trim();

  if (!cleanQuery) {
    throw new Error("Search query is required.");
  }

  const url = new URL("/search", baseUrl);

  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", options.language || "auto");
  url.searchParams.set("safesearch", "1");

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, DEFAULT_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "EST-AI/1.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status}`);
    }

    const data = await response.json();

    const results = Array.isArray(data.results)
      ? data.results.slice(0, 8).map((item) => ({
          title: item.title || "",
          url: item.url || "",
          content: item.content || "",
          engine: item.engine || null,
          category: item.category || null
        }))
      : [];

    return {
      query: cleanQuery,
      results
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatSearchContext(results = []) {
  return results
    .map(
      (item, index) =>
        `[${index + 1}] ${item.title}\nURL: ${item.url}\n${item.content}`
    )
    .join("\n\n");
  }
