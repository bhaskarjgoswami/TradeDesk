// TradeDesk cloud boot. Loaded first on /app, before the journal UI (the local
// desktop app's own HTML/JS, unchanged). The UI calls same-origin /api/...;
// this holds those calls until the auth module (src/cloud/shim.js) is ready,
// which then answers session/login/logout itself and forwards everything else
// to the TradeDesk API with the user's token.
(function () {
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });
  window.__td = { ready: ready, resolve: resolveReady };
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") !== 0) return nativeFetch(input, init);
    return ready.then(function (td) { return td.handle(url, init || {}, nativeFetch); });
  };
})();
