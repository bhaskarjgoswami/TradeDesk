// Walk the cursor-paged trade list (newest first) until the server stops returning a cursor.
// Returns {rows} sorted like the journal expects, or {failed: response} on the first bad page.
export async function fetchAllTrades(url, fetchPage, maxPages = 1000) {
  const search = new URLSearchParams(String(url).split("?")[1] || "");
  search.set("limit", "500");
  const rows = [], seen = new Set();
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(search.toString());
    if (!page.ok) return { failed: page };
    const data = await page.json();
    rows.push(...data.rows);
    const cursor = data.next_cursor;
    if (!cursor || seen.has(cursor)) break; // a repeated cursor would loop forever
    seen.add(cursor);
    search.set("before_id", cursor);
  }
  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.id - a.id);
  return { rows };
}
