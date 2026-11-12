// A content script that does what many real ones do: fetches its own resource on every page.
fetch(chrome.runtime.getURL('data.json')).then((r) => r.json()).then(() => {}).catch(() => {});
