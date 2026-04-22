(function () {
  var configuredBase = window.__OSA_API_BASE__;
  var localHostNames = ["localhost", "127.0.0.1"];
  var hostName = (window.location && window.location.hostname) || "";
  var defaultBase = localHostNames.indexOf(hostName) >= 0 ? "http://127.0.0.1:8787" : "";
  var envBase = (configuredBase && String(configuredBase).trim()) || defaultBase;
  var API_PREFIX = "/api/v1";

  function getJson(url) {
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  window.OSAApiClient = {
    getBaseUrl: function () {
      return envBase + API_PREFIX;
    },
    loadAnnouncements: function () {
      var url = envBase + API_PREFIX + "/announcements";
      return getJson(url).then(function (payload) {
        return toArray(payload && payload.data);
      });
    },
    loadLostFoundItems: function () {
      var url = envBase + API_PREFIX + "/lost-found/items";
      return getJson(url).then(function (payload) {
        return toArray(payload && payload.data);
      });
    },
    loadPageContent: function (page) {
      var safePage = encodeURIComponent(String(page || "").trim().toLowerCase());
      var url = envBase + API_PREFIX + "/content/" + safePage;
      return getJson(url).then(function (payload) {
        return (payload && payload.data) || {};
      });
    },
  };
})();
