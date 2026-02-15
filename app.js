// TODO:
// - review each remaining piece of global state for sanity.

const PLAYPAUSE_CLIENT_ID = "1366988155e64d34b759879f2a575cdd";
const NCSPOT_CLIENT_ID = "d420a117a32841c2b3474932e49fb54b";
const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";
const SCOPES =
  "streaming user-read-email user-read-private user-library-read user-read-playback-state user-modify-playback-state playlist-read-private user-top-read"; // https://developer.spotify.com/documentation/web-api/concepts/scopes

function assert(condition, message) {
  if (condition) {
    return;
  }
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "assert-modal";
  modal.innerHTML = `
    <div class="modal" style="max-width:500px">
      <h2>Assertion failed!</h2>
      <p style="color:#b3b3b3;margin:16px 0"><pre>${message}</pre></p>
      <button onclick="this.closest('.modal-overlay').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  throw new Error(message);
}

function setClientChoice(choice) {
  return localStorage.setItem("chosen_client", choice);
}

function getClientChoice() {
  return localStorage.getItem("chosen_client");
}

function getClientId() {
  const c = getClientChoice();
  switch (c) {
    case "ncspot":
      return NCSPOT_CLIENT_ID;
    case "playpause":
      return PLAYPAUSE_CLIENT_ID;
    case null:
      return null;
    default:
      assert(false, `Unknown client choice: [${c}]`);
  }
}

function getRedirectUri() {
  if (getClientChoice() === "playpause") {
    return window.location.href.split("?")[0].split("#")[0];
  }
  // Try to use our origin (including port!) if on 127.0.0.1, otherwise fall back to manual paste flow.
  const host = window.location.hostname;
  if (host === "127.0.0.1") {
    return `${window.location.origin}/login`;
  }
  return "http://127.0.0.1/login"; // Note excludes the port included in .origin above, will require manual paste.
}

function areDeprecatedFeaturesUnavailable() {
  return localStorage.getItem("chosen_client") === "playpause";
}

// Auth storage helpers - namespace by client ID so switching clients requires re-auth.
function getAuthPrefix() {
  return `auth_${getClientId()}_`;
}
function getAuth(key) {
  return localStorage.getItem(getAuthPrefix() + key);
}
function setAuth(key, value) {
  localStorage.setItem(getAuthPrefix() + key, value);
}
function clearAuth() {
  ["access_token", "refresh_token", "token_expiry", "code_verifier"].map((k) =>
    localStorage.removeItem(getAuthPrefix() + k),
  );
  localStorage.removeItem("chosen_client");
}

let player = null;
let deviceId = null;
let currentState = null;
let currentAlbumUri = null;

let progressInterval = null;
let lastPlayState = null;
let queueRefreshPending = false;
let queueRenderVersion = 0; // Incremented each render to detect stale renders.

// Local queue management.
let localQueue = []; // Array of track URIs.
const playHistory = []; // Track URIs we've played (for previous).
let currentTrackUri = null;
let lastTrackUri = null;
let playingFromQueueInProgress = false; // Guard against rapid duplicate calls.
let isNavigatingBack = false; // Flag to prevent pushing state during popstate.

// Loop mode - when enabled, finished tracks are re-added to end of queue.
let loopEnabled = localStorage.getItem("loop_enabled") === "true";

// Infinite scroll state — single object replaced by each view that supports pagination.
let pagination = null;
let paginationGen = 0; // Incremented on each view load; stale fetchPage callbacks bail out.

// Lyrics.
let lyricsEnabled = false;
let currentLyrics = null;
let lyricsTrackKey = null;
let lyricsSynced = false;

// Navigation. Integrates with browser history.
function navigate(route, params = {}, replace = false) {
  hideLyrics();
  // Reset pagination and tracks element class state on every view change.
  pagination = null;
  paginationGen++;
  const tracksEl = document.getElementById("tracks");
  tracksEl.classList.remove("sectioned", "grid-view");
  localStorage.setItem(
    "last_view",
    params.id ? `${route}:${params.id}` : route,
  );
  const state = { route, params };
  if (!isNavigatingBack) {
    if (replace) {
      history.replaceState(state, "", location.pathname);
    } else {
      history.pushState(state, "", location.pathname);
    }
  }
  setActiveNav(route);
}

function setActiveNav(route) {
  // Clear all active states (except loop button which has its own state).
  for (const b of document.querySelectorAll(
    ".header button.active, .player button.active:not(#loop-btn)",
  ))
    b.classList.remove("active");
  // Set active on matching nav button and focus it.
  const btn = document.getElementById(`nav-${route}`);
  if (btn) {
    btn.classList.add("active");
    btn.focus();
  }
}

const handleNavigation = (() => {
  const routes = {
    album: (p) => loadAlbum(p.id),
    albums: () => loadSavedAlbums(),
    artist: (p) => loadArtist(p.id),
    explore: () => loadExplore(),
    liked: () => loadLikedSongs(),
    playlist: (p) => loadPlaylist(p.id),
    playlists: () => loadPlaylists(),
    queue: () => showQueue(),
    search: (p) => search(p.q),
    topArtists: () => loadTopArtists(),
    topTracks: () => loadTopTracks(),
  };
  return (state) => {
    if (!state?.route) return;
    return routes[state.route]?.(state.params);
  };
})();

window.addEventListener("popstate", (e) => {
  isNavigatingBack = true;
  handleNavigation(e.state);
  isNavigatingBack = false;
});

// PKCE helpers.
function generateCodeVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 128);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function loginWith(clientChoice) {
  setClientChoice(clientChoice); // Store the client choice before starting auth flow.

  const clientId = getClientId();
  const redirectUri = getRedirectUri();
  const verifier = generateCodeVerifier();
  setAuth("code_verifier", verifier);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const authUrl = `https://accounts.spotify.com/authorize?${params}`;

  if (clientChoice === "ncspot") {
    const host = window.location.hostname;
    if (host === "127.0.0.1") {
      // On 127.0.0.1, redirect directly - we can handle the callback.
      window.location = authUrl;
    } else {
      // On hosted version, show manual paste modal.
      showNcspotLoginModal(authUrl);
    }
  } else {
    window.location = authUrl;
  }
}

function showNcspotLoginModal(authUrl) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "ncspot-modal";
  modal.innerHTML = `
    <div class="modal" style="max-width:500px">
      <h2>Login with Spotify (ncspot)</h2>
      <p style="color:#b3b3b3;margin:16px 0">After authorizing, you'll be redirected to a page that won't load. Copy the URL from the popup's address bar and paste it below:</p>
      <button onclick="window.open('${authUrl}', 'spotify-auth', 'width=500,height=700')" style="width:100%;margin-bottom:16px">
        Open Spotify Auth
      </button>
      <input type="text" id="ncspot-url" placeholder="Paste the redirect URL here (http://127.0.0.1/login?code=...)"
        style="width:100%;padding:10px;border-radius:4px;border:1px solid #444;background:#181818;color:#fff;margin-bottom:16px"
        oninput="const b=document.getElementById('ncspot-continue'),v=!!this.value.trim();b.disabled=!v;b.style.opacity=v?1:0.5;b.style.background=v?'#1db954':'#333'" />
      <div style="display:flex;gap:8px">
        <button onclick="this.closest('.modal-overlay').remove()" style="flex:1;background:#333">Cancel</button>
        <button id="ncspot-continue" onclick="handleNcspotUrl()" style="flex:1;opacity:0.5;background:#333" disabled>Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function handleNcspotUrl() {
  const input = document.getElementById("ncspot-url");
  const url = input.value.trim();
  if (!url) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    assert(false, `${e.message}: ${url}`);
  }
  const code = parsedUrl.searchParams.get("code");
  assert(code, `No authorization code found in URL: ${url}`);

  document.getElementById("ncspot-modal").remove();
  assert(
    await processAuthCode(code, false, true),
    "Authentication failed. Please try again.",
  );
}

function logout() {
  if (!confirm("Log out of Spotify?")) return;
  forceRelogin("user logout");
}

function forceRelogin(reason = "unknown") {
  console.error("FORCE RELOGIN:", reason, new Error().stack);
  if (player) player.disconnect();
  clearAuth();
  window.location.reload();
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;
  return await processAuthCode(code, true, false);
}

async function processAuthCode(code, clearUrl = false, reload = false) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: "authorization_code",
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: getAuth("code_verifier"),
    }),
  });
  const data = await res.json();
  assert(data.access_token, `Auth failed: ${data.error || "no access_token"}`);
  setAuth("access_token", data.access_token);
  setAuth("refresh_token", data.refresh_token);
  setAuth("token_expiry", Date.now() + data.expires_in * 1000);
  if (clearUrl) {
    window.history.replaceState({}, "", window.location.href.split("?")[0]);
  }
  if (reload) {
    window.location.reload();
  }
  return true;
}

let refreshPromise = null;
async function refreshToken() {
  assert(
    navigator.onLine,
    "Caller must check navigator.onLine before calling refreshToken.",
  );

  // Prevent concurrent refresh attempts.
  if (refreshPromise) {
    console.log(
      "Token refresh already in progress, reusing previous promise...",
    );
    return refreshPromise;
  }

  const refresh = getAuth("refresh_token");
  if (!refresh) {
    console.warn("No refresh token available!");
    return false;
  }

  console.log("Starting token refresh...");

  refreshPromise = (async () => {
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: getClientId(),
          grant_type: "refresh_token",
          refresh_token: refresh,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        setAuth("access_token", data.access_token);
        setAuth("token_expiry", Date.now() + data.expires_in * 1000);
        if (data.refresh_token) {
          console.log(
            "Saving new refresh token received as part of token refresh.",
          );
          setAuth("refresh_token", data.refresh_token);
        }
        return true;
      }
      console.error(
        "Token refresh failed:",
        data.error,
        data.error_description,
        data,
      );
      return false;
    } catch (e) {
      console.error("Token refresh error:", e);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

const CACHEABLE_PATHS = new Set([
  "albums",
  "playlists",
  "artists",
  "tracks",
  "search",
  "browse",
  "/recommendations",
]);
const API_CACHE = {};
async function api(endpoint, opts = {}) {
  const isCacheable = (endpoint) => {
    endpoint = endpoint.split("?")[0];
    if (endpoint.startsWith("/me/top/")) return true;
    const p = endpoint.split("/");
    if ((p[1] === "users" || p[1] === "/me") && CACHEABLE_PATHS.has(p[3]))
      return true;
    return CACHEABLE_PATHS.has(p[1]) || CACHEABLE_PATHS.has(p[2]);
  };
  var key;
  if (isCacheable(endpoint)) {
    key = JSON.stringify({ endpoint, opts });
    const prev = API_CACHE[key];
    if (prev) return prev;
  }
  const val = _api(endpoint, opts, 0);
  if (key) API_CACHE[key] = val;
  return val;
}

// _retries: number of previous attempts (used internally for 401/403 refresh and 5xx backoff).
async function _api(endpoint, opts, _retries) {
  if (!navigator.onLine) {
    console.warn("Offline: skipping API call.");
    return null;
  }

  // Check if token needs refresh before API call (with 60s buffer).
  if (Date.now() > getAuth("token_expiry") - 60000) {
    console.log("Token expiring soon, refreshing before API call");
    if (!(await refreshToken())) {
      forceRelogin("api: token refresh failed before call");
      return null;
    }
  }

  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getAuth("access_token")}`,
      ...opts.headers,
    },
  });
  if (res.status === 204 || res.status === 202) return null;

  // On 401/403, try refreshing token and retry once.
  if ((res.status === 401 || res.status === 403) && _retries === 0) {
    console.log(`Got ${res.status}, attempting token refresh and retry`);
    if (await refreshToken()) {
      return api(endpoint, opts, 1);
    } else {
      forceRelogin(`api: token refresh failed after ${res.status}`);
      return null;
    }
  }

  // Retry on 5xx with exponential backoff.
  if (res.status >= 500 && _retries < 3) {
    const delay = 500 * 2 ** _retries;
    console.warn(
      `Got ${res.status}, retrying ${endpoint} in ${delay}ms (attempt ${_retries + 1}/3)`,
    );
    await new Promise((r) => setTimeout(r, delay)); // a.k.a. "async sleep".
    return api(endpoint, opts, _retries + 1);
  }

  if (!res.ok) {
    console.error("API error:", res.status, res.statusText, endpoint);
    return null;
  }
  const text = await res.text();
  if (!text) return null;
  try {
    // Do this rather than asking for res.json() above b/c that doesn't distinguish between empty and malformed JSON.
    return JSON.parse(text);
  } catch (e) {
    // Don't log for successful responses - some endpoints return non-JSON.
    if (res.status >= 400) {
      console.error(
        "API error response:",
        res.status,
        endpoint,
        text.substring(0, 200),
        e,
      );
    }
    return null;
  }
}

function stripApiBase(url) {
  return url?.replace("https://api.spotify.com/v1", "") ?? null;
}

// Fetch all pages from a paginated Spotify API endpoint.
async function fetchAllPages(initialUrl, extractItems) {
  const allItems = [];
  let url = initialUrl;
  while (url) {
    const data = await api(url);
    const items = extractItems(data);
    allItems.push(...items);
    url = stripApiBase(data?.next);
  }
  return allItems;
}

// Fetch tracks by IDs, chunking to respect API limit of 50.
async function fetchTracksByIds(trackIds) {
  if (!trackIds || trackIds.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    chunks.push(trackIds.slice(i, i + 50));
  }
  const results = await Promise.all(
    chunks.map((chunk) => api(`/tracks?ids=${chunk.join(",")}`)),
  );
  return results.flatMap((r) => r?.tracks || []);
}

function getDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Browser";
}

function initPlayer() {
  player = new Spotify.Player({
    name: getDeviceName(),
    getOAuthToken: async (cb) => {
      // Refresh with 60s buffer to avoid race conditions.
      if (Date.now() > getAuth("token_expiry") - 60000) {
        console.log("SDK requesting token, refreshing (expiry soon)");
        if (!(await refreshToken())) {
          forceRelogin("SDK getOAuthToken: token refresh failed");
          return;
        }
      }
      cb(getAuth("access_token"));
    },
  });

  player.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    setupMediaSessionHandlers();
    resumePlaybackIfNeeded();
  });

  player.addListener("player_state_changed", (state) => {
    if (!state) {
      console.log("Playback transferred to another device - clearing UI");
      clearPlayerUI();
      return;
    }
    currentState = state;
    const track = state.track_window.current_track;
    currentAlbumUri = track.album.uri;
    updatePlayerUI({
      trackName: track.name,
      trackUri: track.uri,
      artistHtml: artistLinksHtml(track.artists),
      artUrl: track.album.images[0]?.url,
      position: state.position,
      duration: state.duration,
      paused: state.paused,
    });
    updateProgress();

    clearInterval(progressInterval);
    if (!state.paused) progressInterval = setInterval(updateProgress, 1000);
    updateMediaSession(track, state);

    // Store play state in memory (saved to localStorage on beforeunload).
    lastPlayState = {
      trackUri: track.uri,
      position: state.position,
      paused: state.paused,
      contextUri: state.context?.uri || null,
      timestamp: Date.now(),
    };

    // Track changed - refresh queue view and lyrics.
    if (track.uri !== lastTrackUri || queueRefreshPending) {
      if (lastTrackUri && localStorage.getItem("last_view") === "queue") {
        showQueue();
      }

      lastTrackUri = track.uri;
      currentTrackUri = track.uri;
      queueRefreshPending = false;

      // Fetch new lyrics if lyrics view is active.
      if (lyricsEnabled) {
        fetchAndShowLyrics();
      }
    }

    // Detect track ending - paused at position 0.
    if (state.paused && state.position === 0 && track.uri === currentTrackUri) {
      // Guard against multiple rapid calls.
      if (playingFromQueueInProgress) return;

      // If loop enabled, re-add the finished track to end of queue (unless already there).
      if (
        loopEnabled &&
        track.uri &&
        localQueue[localQueue.length - 1] !== track.uri
      ) {
        localQueue.push(track.uri);
        saveLocalQueue();
      }

      // Play next from queue if available.
      if (localQueue.length > 0) {
        playingFromQueueInProgress = true;
        playNextFromLocalQueue().finally(() => {
          playingFromQueueInProgress = false;
        });
      }
    }
  });

  // Log all
  // https://developer.spotify.com/documentation/web-playback-sdk/reference#events
  // and
  // https://developer.spotify.com/documentation/web-playback-sdk/reference#errors
  // for debugging.
  [
    "account_error",
    "authentication_error",
    "autoplay_failed",
    "initialization_error",
    "not_ready",
    "playback_error",
    "player_state_changed",
    "ready",
  ].forEach((eventName) => {
    player.addListener(eventName, (data) => {
      console.log(`[SDK Event: ${eventName}]`, data);
    });
  });

  player.addListener("autoplay_failed", async ({ _message }) => {
    const settingsUrl = `chrome://settings/content/siteDetails?site=${encodeURIComponent(window.location.origin)}`;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px">
        <h2 style="color:#fff">Autoplay <span style="color:#1db954">Blocked</span></h2>
        <p>Please "allow" (not just "Automatic (default)" Sound in your browser site settings to enable autoplay:</p>
        <p style="user-select:all;font-family:monospace;background:#333;padding:8px;border-radius:4px;word-break:break-all">${settingsUrl}</p>
        <button onclick="this.closest('.modal-overlay').remove()">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  });

  player.addListener("authentication_error", async ({ message }) => {
    console.log(`authentication_error: ${message}; attempting refresh...`);
    if (!navigator.onLine) {
      console.warn(
        "Offline: ignoring authentication_error, will retry when back online.",
      );
      return;
    }
    if (await refreshToken()) {
      console.log(
        `Refresh succeeded; now disconnecting, dropping, and re-initPlayer()'ing.`,
      );
      player.disconnect();
      player = null;
      initPlayer();
    } else {
      forceRelogin("SDK authentication error");
    }
  });

  player.connect();
}

window.onSpotifyWebPlaybackSDKReady = () => {
  if (getAuth("access_token")) initPlayer();
};

function showLoading() {
  const el = document.getElementById("tracks");
  el.innerHTML = '<li class="empty-state">Loading...</li>';
}

// Centralised player-UI updater. Pass an info object to show track details,
// or null to clear the player to its empty state.
function updatePlayerUI(info) {
  const buttons = document.querySelectorAll(".player-controls button");
  if (info) {
    const trackId = info.trackUri?.split(":")[2];
    document.getElementById("player-track").innerHTML = trackId
      ? shareLink(
          "track",
          trackId,
          escapeHtml(info.trackName),
          "player.seek(0)",
        )
      : escapeHtml(info.trackName);
    document.getElementById("player-artist").innerHTML = info.artistHtml;
    const art = document.getElementById("player-art");
    art.src = info.artUrl;
    art.style.display = info.artUrl ? "block" : "none";
    document.getElementById("play-btn").textContent = info.paused ? "▶" : "⏸";
    document.getElementById("progress-fill").style.width = info.duration
      ? `${(info.position / info.duration) * 100}%`
      : "0%";
    document.getElementById("progress-current").textContent = formatTime(
      info.position,
    );
    document.getElementById("progress-total").textContent = formatTime(
      info.duration,
    );
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = "1";
    });
  } else {
    document.getElementById("player-track").textContent = "Not playing";
    document.getElementById("player-artist").innerHTML = "";
    const art = document.getElementById("player-art");
    art.src = "";
    art.style.display = "none";
    document.getElementById("play-btn").textContent = "▶";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("progress-current").textContent = "0:00";
    document.getElementById("progress-total").textContent = "0:00";
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    });
  }
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function escapeHtml(s) {
  // Note that a more sophisticated approach would create a DOM
  // element and extract its innerHtml, but that seems like a much
  // more complex thing than needed. Our inputs are always short
  // strings and the DOM approach is only a performance win when the
  // inputs are large (>1KB, definitely, maybe a lot larger than
  // that).
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, "");
}

// Generate shareable link - wraps text in <a> with Spotify URL.
// Left-click does onclick action, right-click gives native "Copy link" option.
function shareLink(type, id, text, onclick) {
  const url = `https://open.spotify.com/${type}/${id}`;
  return `<a href="${url}" onclick="event.preventDefault(); ${onclick}">${text}</a>`;
}

// Return the HTML for a (possibly disabled) radio button.
function radioBtn(type, id) {
  if (areDeprecatedFeaturesUnavailable()) {
    return `<button class="radio-btn unavailable" title="Start radio - Unavailable" disabled>📻</button>`;
  }
  return `<button class="radio-btn" onclick="event.stopPropagation(); startRadio('${type}', '${id}')" title="Start radio">📻</button>`;
}

// Radio: get recommendations and add to queue.
async function startRadio(type, id) {
  let seedParam = "";

  if (type === "track") {
    seedParam = `seed_tracks=${id}`;
  } else if (type === "artist") {
    seedParam = `seed_artists=${id}`;
  } else if (type === "album") {
    const trackIds = (await api(`/albums/${id}`)).tracks?.items
      ?.map((t) => t.id)
      .slice(0, 5) // 5 seed item limit enforced by the API.
      .join(",");
    assert(trackIds, `Failed to fetch tracks for /albums/${id}`);
    seedParam = `seed_tracks=${trackIds}`;
  } else if (type === "playlist") {
    const trackIds = (await api(`/playlists/${id}/items`)).items
      ?.map((i) => i.item)
      .filter(Boolean)
      ?.map((t) => t.id)
      .slice(0, 5) // 5 seed item limit enforced by the API.
      .join(",");
    assert(trackIds, `Failed to fetch /playlists/${id}/items`);
    seedParam = `seed_tracks=${trackIds}`;
  }

  const recs = await api(`/recommendations?${seedParam}&limit=50`);
  assert(recs?.tracks?.length, `No recommendations found for ${seedParam}`);

  await clearQueue();

  if (type === "track") {
    localQueue.push(`spotify:track:${id}`);
  }
  recs.tracks
    .map((t) => t.uri)
    .forEach((uri) => {
      if (!localQueue.includes(uri)) {
        localQueue.push(uri);
      }
    });
  saveLocalQueue();

  await showQueue();
  await next();
}

async function updateProgress() {
  if (!currentState) return;
  const state = await player.getCurrentState();
  if (!state) return;
  const pct = (state.position / state.duration) * 100;
  document.getElementById("progress-fill").style.width = `${pct}%`;
  document.getElementById("progress-current").textContent = formatTime(
    state.position,
  );

  // Update lyrics highlight.
  if (lyricsEnabled && lastPlayState) {
    lastPlayState.position = state.position;
    updateLyricsHighlight();
  }
}

(() => {
  const bar = document.getElementById("progress-bar");
  const tooltip = document.getElementById("seek-tooltip");

  function showTooltip(e) {
    if (!currentState) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * currentState.duration;
    tooltip.textContent = formatTime(time);
    tooltip.style.left = `${pct * 100}%`;
    tooltip.style.display = "block";
  }

  bar.addEventListener("mousemove", showTooltip);
  bar.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
  bar.addEventListener("click", (e) => {
    if (!currentState) return;
    const rect = bar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    player.seek(pct * currentState.duration);
  });
})();

async function search(q) {
  navigate("search", { q });
  setBreadcrumb([{ name: `Search: ${q}` }]);
  showLoading();

  let allArtists = [];
  let allAlbums = [];
  let allTracks = [];

  const data = await api(
    `/search?type=artist,track,album&limit=50&q=${encodeURIComponent(q)}`,
  );
  allArtists = data.artists?.items || [];
  allAlbums = data.albums?.items || [];
  allTracks = data.tracks?.items || [];

  // Fetch more albums & tracks if available (up to 100 total).
  if (data.albums?.next) {
    const more = await api(stripApiBase(data.albums.next));
    allAlbums = allAlbums.concat(more?.items || []);
  }
  if (data.tracks?.next) {
    const more = await api(stripApiBase(data.tracks.next));
    allTracks = allTracks.concat(more?.items || []);
  }

  const results = {
    artists: { items: allArtists },
    albums: { items: allAlbums },
    tracks: { items: allTracks },
  };
  localStorage.setItem(
    "last_search",
    // Local storage has a 5MB per-origin limit, so it might seem
    // worrisome to store hundreds of search results
    // here. Experimenting shows that this is not in fact an
    // issue. E.g. searching [queen] results in 50
    // Artists/Albums/Tracks for a total of 150 records, but
    // localStorage.last_search.length is just 256588. Slimming the
    // results to just the fields used in rendering only reduces this
    // to 51566. Not worth doing.
    JSON.stringify({ query: q, data: results }),
  );
  renderSearchResults(results);
}

// Unified list item renderer. Each caller provides a mapper that returns a
// descriptor; renderItem turns it into <li> HTML.
function renderItem(d) {
  const overlay = d.playAction ? '<div class="play-overlay"></div>' : "";
  const artClick = d.playAction
    ? `onclick="event.stopPropagation(); ${d.playAction}"`
    : "";
  const imgStyle = d.imgStyle ? ` style="${d.imgStyle}"` : "";
  const liClick = d.liOnclick ? ` onclick="${d.liOnclick}"` : "";
  const liClass = d.liClass ? `track ${d.liClass}` : "track";
  return `
    <li class="${liClass}"${d.liAttr || ""}${liClick}>
      <div class="track-num-col">
        <span class="track-num">${d.num}</span>
        ${d.queueBtn || ""}
        ${d.radioType ? radioBtn(d.radioType, d.radioId) : ""}
      </div>
      <div class="track-art" ${artClick}>
        <img src="${d.imgSrc || ""}"${imgStyle} />
        ${overlay}
      </div>
      <div class="track-info">
        <div class="track-name" title="${d.nameTitle || ""}">${d.nameHtml}</div>
        <div class="track-artist"${d.subtitleTitle ? ` title="${d.subtitleTitle}"` : ""}>${d.subtitle || ""}</div>
        ${d.extraLines || ""}
      </div>
      ${d.suffix || ""}
    </li>`;
}

function renderItems(items, mapFn, startNum = 1) {
  return items
    .map((item, i) => renderItem(mapFn(item, i, startNum + i)))
    .join("");
}

// --- Shared mapper helpers ---

function artistLinksHtml(artists) {
  return (artists || [])
    .map((a) => {
      const id = a.id || a.uri?.split(":")[2] || "";
      if (!id) return escapeHtml(a.name);
      return `<span class="artist-link">${shareLink("artist", id, escapeHtml(a.name), `event.stopPropagation(); loadArtist('${id}')`)}</span>`;
    })
    .join(", ");
}

function queueAddBtn(onclick) {
  return `<button class="queue-btn" onclick="event.stopPropagation(); ${onclick}" title="Add to queue (Shift: play next)">+</button>`;
}

function playlistOnclick(p) {
  return `loadPlaylist('${p.id}')`;
}

// --- Item mappers ---

// Shared fields for track and queue-track mappers.
function baseTrackFields(t) {
  const trackId = t.uri?.split(":")[2] || t.id;
  return {
    trackId,
    radioType: "track",
    radioId: trackId,
    imgSrc: t.album?.images?.[2]?.url || "",
    nameTitle: escapeHtml(t.name),
    subtitle: artistLinksHtml(t.artists),
    subtitleTitle: escapeHtml(t.artists?.map((a) => a.name).join(", ") || ""),
  };
}

function trackMapper(contextUri, contextOffset = 0) {
  return (t, i, num) => {
    const base = baseTrackFields(t);
    const albumId = t.album?.id || t.album?.uri?.split(":")[2] || "";
    const playAction = contextUri
      ? `playFromContext('${contextUri}', ${contextOffset + i})`
      : `playTrack('${t.uri}')`;
    return {
      ...base,
      num,
      queueBtn: queueAddBtn(`addToQueue(['${t.uri}'], event.shiftKey)`),
      playAction,
      nameHtml: shareLink(
        "track",
        base.trackId,
        escapeHtml(t.name),
        `event.stopPropagation(); ${playAction}`,
      ),
      extraLines: t.album
        ? `<div class="track-album" title="${escapeHtml(t.album.name)}">${shareLink("album", albumId, escapeHtml(t.album.name), `event.stopPropagation(); loadAlbum('${albumId}')`)}</div>`
        : "",
    };
  };
}

function albumMapper(a, _i, num) {
  return {
    num,
    queueBtn: queueAddBtn(`addAlbumToQueue('${a.id}', event.shiftKey)`),
    radioType: "album",
    radioId: a.id,
    imgSrc: a.images?.[2]?.url || "",
    playAction: `playContext('${a.uri}')`,
    nameHtml: shareLink(
      "album",
      a.id,
      escapeHtml(a.name),
      `event.stopPropagation(); loadAlbum('${a.id}')`,
    ),
    nameTitle: escapeHtml(a.name),
    subtitle: artistLinksHtml(a.artists),
    subtitleTitle: escapeHtml(a.artists?.map((x) => x.name).join(", ") || ""),
    liOnclick: `loadAlbum('${a.id}')`,
  };
}

function discographyAlbumMapper(a, i, num) {
  return {
    ...albumMapper(a, i, num),
    subtitle: `${a.album_type} \u2022 ${a.release_date?.slice(0, 4)}`,
    subtitleTitle: undefined,
  };
}

function playlistMapper(p, _i, num) {
  return {
    num,
    queueBtn: queueAddBtn(`addPlaylistToQueue('${p.id}', event.shiftKey)`),
    radioType: "playlist",
    radioId: p.id,
    imgSrc: p.images?.[0]?.url || "",
    playAction: `playContext('spotify:playlist:${p.id}')`,
    nameHtml: shareLink(
      "playlist",
      p.id,
      escapeHtml(p.name),
      `event.stopPropagation(); ${playlistOnclick(p)}`,
    ),
    nameTitle: escapeHtml(p.name),
    subtitle: `${p.tracks.total} tracks`,
    liOnclick: playlistOnclick(p),
  };
}

function playlistSectionMapper(p, i, num) {
  return {
    ...playlistMapper(p, i, num),
    subtitle: stripHtml(p.description || ""),
  };
}

function artistMapper(a, _i, num) {
  return {
    num,
    radioType: "artist",
    radioId: a.id,
    imgSrc: a.images?.[2]?.url || a.images?.[0]?.url || "",
    imgStyle: "border-radius:50%",
    nameHtml: shareLink(
      "artist",
      a.id,
      escapeHtml(a.name),
      `event.stopPropagation(); loadArtist('${a.id}')`,
    ),
    nameTitle: escapeHtml(a.name),
    subtitle: a.genres?.slice(0, 2).join(", ") || "",
    subtitleTitle: a.genres?.slice(0, 2).join(", ") || "",
    liOnclick: `loadArtist('${a.id}')`,
  };
}

function searchArtistMapper(a, i, num) {
  return {
    ...artistMapper(a, i, num),
    subtitle: `${a.followers?.total?.toLocaleString() || 0} followers`,
    subtitleTitle: undefined,
  };
}

function queueTrackMapper(t, i, num) {
  if (!t) return { num, imgSrc: "", nameHtml: "", nameTitle: "" };
  return {
    ...baseTrackFields(t),
    num,
    queueBtn: `<button class="queue-btn" onclick="event.stopPropagation(); removeFromQueue(${i})" title="Remove from queue">\u2212</button>`,
    playAction: `playFromLocalQueue(${i})`,
    nameHtml: shareLink(
      "track",
      t.id,
      escapeHtml(t.name),
      `event.stopPropagation(); playFromLocalQueue(${i})`,
    ),
    extraLines: t.album
      ? `<div class="track-album" title="${escapeHtml(t.album.name)}" onclick="event.stopPropagation(); loadAlbum('${t.album.id}')">${escapeHtml(t.album.name)}</div>`
      : "",
    liClass: "queue-item",
    liAttr: ` draggable="true" data-index="${i}" ondragstart="onQueueDragStart(event)" ondragend="onQueueDragEnd(event)" ondragover="onQueueDragOver(event)" ondragleave="onQueueDragLeave(event)" ondrop="onQueueDrop(event)"`,
    suffix: '<div class="drag-handle" title="Drag to reorder">\u2261</div>',
  };
}

// --- Render functions (thin wrappers) ---

function renderTrackItems(tracks, contextUri, startNum = 1, contextOffset = 0) {
  return renderItems(tracks, trackMapper(contextUri, contextOffset), startNum);
}

function renderSearchResults(data) {
  const el = document.getElementById("tracks");
  pagination = null;
  paginationGen++;
  let html = "";
  if (data.artists?.items.length) {
    html += '<h3 class="results-heading">Artists</h3>';
    html += renderItems(data.artists.items, searchArtistMapper);
  }
  if (data.albums?.items.length) {
    html += '<h3 class="results-heading">Albums</h3>';
    html += renderItems(data.albums.items, albumMapper);
  }
  if (data.tracks?.items.length) {
    html += '<h3 class="results-heading">Tracks</h3>';
    html += renderTrackItems(data.tracks.items, null);
  }
  el.innerHTML = html;
}

async function play(body) {
  assert(deviceId, "No device ID - player not ready");
  await api(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function playTrack(uri) {
  return play({ uris: [uri] });
}

// Fetch tracks from album/playlist and add to front of queue.
async function playContext(uri) {
  return playFromContext(uri, 0);
}

// Play specific track and queue the rest from that position.
async function playFromContext(uri, offset) {
  const [, type, id] = uri.split(":");
  let trackUris = [];

  if (type === "album") {
    const album = await api(`/albums/${id}`);
    trackUris = album?.tracks?.items?.map((t) => t.uri).filter(Boolean) || [];
  } else if (type === "playlist") {
    trackUris = await fetchAllPages(
      `/playlists/${id}/items?limit=100`,
      (data) => (data?.items || []).map((i) => i.item?.uri).filter(Boolean),
    );
  }

  if (trackUris.length === 0) return;

  // Start from offset position.
  const tracksFromOffset = trackUris.slice(offset);
  localQueue = tracksFromOffset.concat(localQueue);
  saveLocalQueue();
  await showQueue();
  await playNextFromLocalQueue();
}

async function playDJ() {
  await play({ context_uri: `spotify:playlist:${DJ_PLAYLIST_ID}` });
  showQueue();
}

function saveLocalQueue() {
  localStorage.setItem("local_queue", JSON.stringify(localQueue));
}

function loadLocalQueue() {
  localQueue = JSON.parse(localStorage.getItem("local_queue")) || [];
  updateQueueButtons();
}

// Enable/disable play/next/prev buttons based on queue and history state.
function updateQueueButtons() {
  const hasQueue = localQueue.length > 0;
  const hasHistory = playHistory.length > 0;
  const playBtn = document.getElementById("play-btn");
  const nextBtn = document.getElementById("next-btn");
  const prevBtn = document.getElementById("prev-btn");
  assert(playBtn && nextBtn && prevBtn, "Missing button!");
  if (hasQueue) {
    playBtn.disabled = false;
    playBtn.style.opacity = "1";
    if (localQueue.length > 1) {
      nextBtn.disabled = false;
      nextBtn.style.opacity = "1";
    }
  }
  prevBtn.disabled = !hasHistory;
  prevBtn.style.opacity = hasHistory ? "1" : "0.5";
}

async function addToQueue(uris, toFront = false) {
  if (toFront) {
    localQueue.unshift(...uris);
  } else {
    localQueue.push(...uris);
  }
  saveLocalQueue();
  updateQueueButtons();
  await showQueue();
  // Automatically start playing if idle.
  const state = await player.getCurrentState();
  if (!state || state.paused) return playNextFromLocalQueue();
}

async function addAlbumToQueue(albumId, toFront = false) {
  const data = await api(`/albums/${albumId}`);
  const trackUris = data.tracks?.items?.map((t) => t.uri) || [];
  return addToQueue(trackUris, toFront);
}

async function addPlaylistToQueue(playlistId, toFront = false) {
  const trackUris = await fetchAllPages(
    `/playlists/${playlistId}/items?limit=100`,
    (data) => (data?.items || []).map((i) => i.item?.uri).filter(Boolean),
  );
  return addToQueue(trackUris, toFront);
}

function removeFromQueue(index) {
  if (index >= 0 && index < localQueue.length) {
    localQueue.splice(index, 1);
    saveLocalQueue();
    showQueue();
  }
}

function toggleLoop() {
  loopEnabled = !loopEnabled;
  localStorage.setItem("loop_enabled", loopEnabled);
  updateLoopButton();
}

function updateLoopButton() {
  const btn = document.getElementById("loop-btn");
  if (btn) {
    btn.classList.toggle("active", loopEnabled);
  }
}

function hideLyrics() {
  if (!lyricsEnabled) return;
  lyricsEnabled = false;
  document.getElementById("cc-btn").classList.remove("active");
  document.getElementById("lyrics-view").classList.remove("active");
  document.getElementById("tracks").style.display = "";
}

function toggleLyrics() {
  lyricsEnabled = !lyricsEnabled;
  const btn = document.getElementById("cc-btn");
  const lyricsView = document.getElementById("lyrics-view");
  const tracksView = document.getElementById("tracks");

  btn.classList.toggle("active", lyricsEnabled);
  lyricsView.classList.toggle("active", lyricsEnabled);
  tracksView.style.display = lyricsEnabled ? "none" : "";

  if (lyricsEnabled && lastPlayState) {
    fetchAndShowLyrics();
  }
}

async function fetchAndShowLyrics() {
  const lyricsView = document.getElementById("lyrics-view");
  if (!lastPlayState?.trackUri) {
    lyricsView.innerHTML = '<div class="lyrics-error">No track playing</div>';
    return;
  }

  const trackName = document.getElementById("player-track")?.textContent || "";
  const artistName =
    document.getElementById("player-artist")?.textContent || "";
  const trackKey = `${artistName} ${trackName}`;

  if (trackKey === lyricsTrackKey && currentLyrics) {
    renderLyrics();
    return;
  }

  lyricsTrackKey = trackKey;
  lyricsView.innerHTML = '<div class="lyrics-error">Loading lyrics...</div>';

  try {
    const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}`;
    const res = await fetch(url);
    if (!res.ok) {
      currentLyrics = null;
      lyricsView.innerHTML =
        '<div class="lyrics-error">No lyrics available</div>';
      return;
    }
    const data = await res.json();

    if (data?.syncedLyrics) {
      // Parse LRC format: [mm:ss.xx]text.
      lyricsSynced = true;
      currentLyrics = data.syncedLyrics
        .split("\n")
        .map((line) => {
          const match = line.match(/^\[(\d+):(\d+\.\d+)\](.*)$/);
          if (!match) return null;
          const time =
            parseInt(match[1], 10) * 60000 + parseFloat(match[2]) * 1000;
          return { time, words: match[3] };
        })
        .filter((l) => l && (l.time > 0 || l.words.trim()));
    } else if (data?.plainLyrics) {
      // Fall back to plain lyrics (no timestamps, no highlighting).
      lyricsSynced = false;
      currentLyrics = data.plainLyrics
        .split("\n")
        .map((line, i) => ({
          time: i,
          words: line,
        }))
        .filter((l) => l.words.trim());
      currentLyrics.unshift({
        time: -1,
        words:
          "<p style='margin-top: 2em;margin-bottom: 2em;'>[missing time-sync data for these lyrics 😕]</p>",
      });
    } else {
      currentLyrics = null;
      lyricsView.innerHTML =
        '<div class="lyrics-error">No lyrics available</div>';
      return;
    }

    renderLyrics();
  } catch (e) {
    console.error("Lyrics fetch error:", e);
    currentLyrics = null;
    lyricsView.innerHTML =
      '<div class="lyrics-error">Failed to load lyrics</div>';
  }
}

function renderLyrics() {
  const lyricsView = document.getElementById("lyrics-view");
  if (!currentLyrics || currentLyrics.length === 0) {
    lyricsView.innerHTML =
      '<div class="lyrics-error">No lyrics available</div>';
    return;
  }

  const track = currentState?.track_window?.current_track;
  const title = track
    ? `<i>${track.name}</i> - ${track.artists.map((a) => a.name).join(", ")} - <i>${track.album.name}</i>`
    : "";

  const lineClass = lyricsSynced ? "lyric-line" : "lyric-line plain";
  lyricsView.innerHTML =
    `<div class="lyrics-title-wrap"><div class="lyrics-title">${title}</div></div><div class="lyrics-lines">` +
    currentLyrics
      .map((line, _i) =>
        lyricsSynced
          ? `<div class="${lineClass}" data-time="${line.time}" onclick="seekToLyric(${line.time})">${line.words || "♪"}</div>`
          : `<div class="${lineClass}">${line.words || ""}</div>`,
      )
      .join("") +
    "</div>";

  if (lyricsSynced) updateLyricsHighlight();
}

function seekToLyric(timeMs) {
  if (player) player.seek(timeMs);
}

function updateLyricsHighlight() {
  if (!lyricsEnabled || !currentLyrics || !lastPlayState || !lyricsSynced)
    return;

  const position = lastPlayState.position;
  const lines = document.querySelectorAll("#lyrics-view .lyric-line");
  let activeIndex = 0;

  // Find the current line based on position.
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentLyrics[i].time <= position) {
      activeIndex = i;
    } else {
      break;
    }
  }

  lines.forEach((line, i) => {
    line.classList.toggle("active", i === activeIndex);
  });

  // Scroll active line into view.
  const activeLine = lines[activeIndex];
  if (activeLine) {
    activeLine.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function playNextFromLocalQueue() {
  if (localQueue.length === 0) return;

  // Add current track to history before moving to next.
  if (currentTrackUri) {
    playHistory.push(currentTrackUri);
    // Limit history size.
    if (playHistory.length > 100) playHistory.shift();
  }

  const nextUri = localQueue.shift();
  saveLocalQueue();
  await playTrack(nextUri);
}

async function togglePlay() {
  const state = await player?.getCurrentState();
  if (state) {
    player?.togglePlay();
    return;
  }

  const saved = localStorage.getItem("play_state");
  if (!saved) {
    // No saved state - play from queue if available.
    if (localQueue.length > 0) {
      await playNextFromLocalQueue();
    }
    return;
  }

  const s = JSON.parse(saved);
  if (!s.contextUri && !s.trackUri) {
    console.log("Nothing to resume playing from localStorage.play_state:", s);
    return;
  }
  if (!s.contextUri) {
    return await play({ uris: [s.trackUri], position_ms: s.position || 0 });
  }
  if (!s.trackUri || !s.trackUri.startsWith("spotify:track:")) {
    return await play({ context_uri: s.contextUri });
  }
  await play({
    context_uri: s.contextUri,
    offset: { uri: s.trackUri },
    position_ms: s.position || 0,
  });
}

async function next() {
  const state = await player?.getCurrentState();
  if (state?.context.metadata.context_description === "DJ") {
    return player.nextTrack();
  }

  // If loop enabled, add current track to end of queue before skipping (unless already there).
  if (
    loopEnabled &&
    currentTrackUri &&
    localQueue[localQueue.length - 1] !== currentTrackUri
  ) {
    localQueue.push(currentTrackUri);
    saveLocalQueue();
  }

  if (localQueue.length > 0) {
    // Skip first item (current/next) and play second if nothing playing, else play first (next).
    if (!state && localQueue.length > 1) {
      // Nothing playing - "next" means skip to second item in queue.
      localQueue.shift(); // Discard first.
      saveLocalQueue();
    }
    await playNextFromLocalQueue();
  }
}

async function previous() {
  const state = await player?.getCurrentState();
  if (state?.context.metadata.context_description === "DJ") {
    return player.previousTrack();
  }

  if (playHistory.length === 0) return;

  if (currentTrackUri) {
    localQueue.unshift(currentTrackUri);
    saveLocalQueue();
  }

  // Play previous track from history.
  const prevUri = playHistory.pop();
  await playTrack(prevUri);
  updateQueueButtons();
  refreshQueueIfViewing();
}

function refreshQueueIfViewing() {
  // Just mark that we want a refresh - the player_state_changed handler will do the actual refresh.
  if (localStorage.getItem("last_view") === "queue") {
    queueRefreshPending = true;
  }
}

async function loadDevices() {
  const data = await api("/me/player/devices");
  const menu = document.getElementById("device-menu");
  let html = data.devices
    .map(
      (d) => `
    <div class="device-item ${d.is_active ? "active" : ""}" onclick="transferPlayback('${d.id}')">
      ${escapeHtml(d.name)}
    </div>
  `,
    )
    .join("");

  if (data.devices.length <= 1) {
    html +=
      '<div style="padding:8px;color:#b3b3b3;font-size:12px;border-top:1px solid #404040;margin-top:8px">To play on another device, open this page in another browser or device.</div>';
  }

  menu.innerHTML = html;
}

function toggleDevices() {
  const menu = document.getElementById("device-menu");
  menu.classList.toggle("show");
  if (menu.classList.contains("show")) loadDevices();
}

async function transferPlayback(id) {
  await api("/me/player", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [id] }),
  });
  document.getElementById("device-menu").classList.remove("show");
}

async function loadPaginatedView({
  route,
  breadcrumb,
  url,
  extractItems,
  renderItems,
}) {
  navigate(route);
  setBreadcrumb(breadcrumb);
  const el = document.getElementById("tracks");
  el.classList.add("grid-view");
  el.innerHTML = "";
  document.querySelector(".content").scrollTop = 0;

  let count = 0;
  const gen = paginationGen;
  const p = makePagination(url, async (nextUrl) => {
    const data = await api(nextUrl);
    if (gen !== paginationGen) return null; // View changed, stop.
    const items = extractItems(data);
    el.insertAdjacentHTML("beforeend", renderItems(items, count + 1));
    count += items.length;
    return data.next;
  });
  pagination = p;
  while (p.active && count < 300) await p.loadMore();
}

async function loadLikedSongs() {
  return loadPaginatedView({
    route: "liked",
    breadcrumb: [{ name: "Liked Songs" }],
    url: "/me/tracks?limit=50",
    extractItems: (data) =>
      (data.items || []).map((i) => i.track).filter(Boolean),
    renderItems: (tracks, n) => renderTrackItems(tracks, null, n),
  });
}

async function loadSavedAlbums() {
  return loadPaginatedView({
    route: "albums",
    breadcrumb: [{ name: "Saved Albums" }],
    url: "/me/albums?limit=50",
    extractItems: (data) =>
      (data.items || []).map((i) => i.album).filter(Boolean),
    renderItems: (albums, n) => renderItems(albums, albumMapper, n),
  });
}

async function loadPlaylists() {
  return loadPaginatedView({
    route: "playlists",
    breadcrumb: [{ name: "Playlists" }],
    url: "/me/playlists?limit=50",
    extractItems: (data) =>
      (data.items || []).filter((p) => p && p.id !== DJ_PLAYLIST_ID),
    renderItems: (playlists, n) => renderItems(playlists, playlistMapper, n),
  });
}

async function loadTopArtists() {
  return loadPaginatedView({
    route: "topArtists",
    breadcrumb: [{ name: "Top Artists" }],
    url: "/me/top/artists?limit=50&time_range=medium_term",
    extractItems: (data) => data.items || [],
    renderItems: (artists, n) => renderItems(artists, artistMapper, n),
  });
}

async function loadTopTracks() {
  return loadPaginatedView({
    route: "topTracks",
    breadcrumb: [{ name: "Top Tracks" }],
    url: "/me/top/tracks?limit=50&time_range=medium_term",
    extractItems: (data) => data.items || [],
    renderItems: (tracks, n) => renderTrackItems(tracks, null, n),
  });
}

function renderPlaylistSection(playlists, startNum = 1) {
  return renderItems(playlists, playlistSectionMapper, startNum);
}

// Shared state for Explore pagination (needs seenIds across pages).
let exploreSeenIds = new Set();

async function loadExplore() {
  navigate("explore");
  setBreadcrumb([{ name: "Explore" }]);
  const el = document.getElementById("tracks");
  el.classList.remove("grid-view");
  el.classList.add("sectioned");
  el.innerHTML = "";
  document.querySelector(".content").scrollTop = 0;

  const gen = paginationGen;
  exploreSeenIds = new Set();

  // Search for personalized playlists.
  const personalizedSearches = [
    "Release Radar",
    "Discover Weekly",
    "Daily Mix 1",
    "Daily Mix 2",
    "Daily Mix 3",
    "Daily Mix 4",
    "Daily Mix 5",
    "Daily Mix 6",
  ];

  // Start all fetches in parallel.
  // (Note that unlike e.g. DJ, these playlists have per-user IDs, so must fetch and can't hardcode).
  const mixesPromise = Promise.all(
    personalizedSearches.map((q) =>
      api(`/search?type=playlist&limit=1&q=${encodeURIComponent(q)}`),
    ),
  );
  const madeForYouPromise = api(
    "/browse/categories/0JQ5DAt0tbjZptfcdMSKl3/playlists?limit=50",
  );
  const featuredPromise = api("/browse/featured-playlists?limit=50");

  // Render Your Mixes as soon as ready.
  const searchResults = await mixesPromise;
  const personalizedPlaylists = [];
  personalizedSearches.forEach((searchName, idx) => {
    const results = searchResults[idx]?.playlists?.items || [];
    const match =
      results.find(
        (p) =>
          p.name.toLowerCase() === searchName.toLowerCase() &&
          p.owner?.id === "spotify",
      ) ||
      results.find((p) =>
        p.name.toLowerCase().startsWith(searchName.toLowerCase()),
      );
    if (match && !exploreSeenIds.has(match.id)) {
      personalizedPlaylists.push(match);
      exploreSeenIds.add(match.id);
    }
  });
  if (personalizedPlaylists.length > 0) {
    el.insertAdjacentHTML(
      "beforeend",
      `<div class="section-header">Your Mixes</div>`,
    );
    el.insertAdjacentHTML(
      "beforeend",
      `<ul class="playlist-section">${renderPlaylistSection(personalizedPlaylists, 1)}</ul>`,
    );
  }

  // Render Made For You as soon as ready.
  const madeForYouData = await madeForYouPromise;
  const madeForYouPlaylists = (madeForYouData?.playlists?.items || []).filter(
    (p) => p && !exploreSeenIds.has(p.id),
  );
  for (const p of madeForYouPlaylists) exploreSeenIds.add(p.id);
  if (madeForYouPlaylists.length > 0) {
    el.insertAdjacentHTML(
      "beforeend",
      `<div class="section-header">Made For You</div>`,
    );
    el.insertAdjacentHTML(
      "beforeend",
      `<ul class="playlist-section">${renderPlaylistSection(madeForYouPlaylists, 1)}</ul>`,
    );
  }

  // Render Featured Playlists, paginating.
  let featuredCount = 0;
  const featuredData = await featuredPromise;
  const items = (featuredData?.playlists?.items || []).filter(
    (p) => p && !exploreSeenIds.has(p.id),
  );
  for (const p of items) exploreSeenIds.add(p.id);
  featuredCount += items.length;

  // Render first batch immediately.
  el.insertAdjacentHTML(
    "beforeend",
    `<div class="section-header">Featured Playlists</div>`,
  );
  el.insertAdjacentHTML(
    "beforeend",
    `<ul class="playlist-section" id="featured-section">${renderPlaylistSection(items, 1)}</ul>`,
  );

  // Paginate Featured playlists (eagerly up to 300, then infinite scroll).
  const featuredUrl = stripApiBase(featuredData?.playlists?.next);
  const p = !featuredUrl
    ? null
    : makePagination(featuredUrl, async (nextUrl) => {
        const data = await api(nextUrl);
        if (gen !== paginationGen) return null;
        const newItems = (data.playlists?.items || []).filter(
          (p) => p && !exploreSeenIds.has(p.id),
        );
        if (newItems.length > 0) {
          document
            .getElementById("featured-section")
            .insertAdjacentHTML(
              "beforeend",
              renderPlaylistSection(newItems, featuredCount + 1),
            );
          for (const p of newItems) exploreSeenIds.add(p.id);
          featuredCount += newItems.length;
        }
        return data.playlists?.next;
      });
  pagination = p;
  while (p?.active && featuredCount < 300) await p.loadMore();
}

async function loadPlaylist(id) {
  navigate("playlist", { id });

  setBreadcrumb([
    { name: "Playlists", action: "loadPlaylists()" },
    { name: "Loading..." },
  ]);

  showLoading();
  const contextUri = `spotify:playlist:${id}`;

  const [_, allTracks] = await Promise.all([
    api(`/playlists/${id}`).then((d) => {
      setBreadcrumb([
        { name: "Playlists", action: "loadPlaylists()" },
        { name: d.name || "Playlist" },
      ]);
    }),
    fetchAllPages(`/playlists/${id}/items?limit=50`, (data) =>
      (data?.items || []).map((i) => i.item).filter(Boolean),
    ),
  ]);
  document.getElementById("tracks").innerHTML = renderTrackItems(
    allTracks,
    contextUri,
  );
}

async function loadAlbum(id) {
  navigate("album", { id });
  const data = await api(`/albums/${id}`);
  setBreadcrumb([{ name: `Album: ${data.name}` }]);
  const contextUri = data.uri;
  const tracks = data.tracks.items.map((t) => ({
    ...t,
    album: { id: data.id, name: data.name, images: data.images },
  }));
  const artistLinks = artistLinksHtml(data.artists);
  document.getElementById("tracks").innerHTML =
    `
    <div class="detail-float">
      <div class="track-art" style="width:150px;height:150px" onclick="playContext('${contextUri}')">
        <img src="${data.images?.[1]?.url || ""}" class="detail-art" />
        <div class="play-overlay" style="font-size:48px"></div>
      </div>
      <div style="width:150px;margin-top:8px">
        <div class="detail-type">ALBUM</div>
        <div class="detail-title">${shareLink("album", data.id, escapeHtml(data.name), `playContext('${contextUri}')`)}</div>
        <div class="detail-meta">${artistLinks}</div>
        <div class="detail-meta">${data.release_date?.slice(0, 4)} • ${data.total_tracks} tracks</div>
      </div>
    </div>
  ` +
    `<div style="clear:left"></div>` +
    renderTrackItems(tracks, contextUri);
}

async function showCurrentAlbum() {
  if (!currentAlbumUri) return;
  const id = currentAlbumUri.split(":")[2];
  loadAlbum(id);
}

function renderAlbumItems(albums, startNum = 1) {
  return renderItems(albums, discographyAlbumMapper, startNum);
}

async function loadArtist(id) {
  navigate("artist", { id });
  showLoading();

  const [artist, topTracks, albumsData] = await Promise.all([
    api(`/artists/${id}`),
    api(`/artists/${id}/top-tracks?market=US`),
    api(`/artists/${id}/albums?include_groups=album,single&limit=50`),
  ]);

  setBreadcrumb([{ name: artist.name }]);

  const el = document.getElementById("tracks");
  let html = `
    <div class="artist-hero">
      <img src="${artist.images?.[1]?.url || ""}" class="artist-avatar" />
      <div>
        <div class="detail-type">ARTIST</div>
        <h1 class="artist-name">${shareLink("artist", artist.id, escapeHtml(artist.name), "")}</h1>
        <div style="color:#b3b3b3">${artist.followers?.total?.toLocaleString() || 0} followers</div>
      </div>
    </div>
  `;

  if (topTracks.tracks?.length) {
    html += '<h3 class="results-heading">Top Tracks</h3>';
    html += renderTrackItems(topTracks.tracks.slice(0, 5), null);
  }

  const firstAlbums = albumsData.items || [];
  const nextAlbumsUrl = stripApiBase(albumsData.next);
  const remainingAlbums = nextAlbumsUrl
    ? await fetchAllPages(nextAlbumsUrl, (data) => data.items || [])
    : [];
  const allAlbums = firstAlbums.concat(remainingAlbums);
  if (allAlbums.length) {
    html += '<h3 class="results-heading">Discography</h3>';
    html += renderAlbumItems(allAlbums, 1);
  }

  el.innerHTML = html;
}

async function showQueue() {
  navigate("queue");
  setBreadcrumb([
    {
      name: "Queue",
      suffix:
        '<button onclick="clearQueue()" style="background:#333;border:none;color:#b3b3b3;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;margin-left:8px">Clear</button>',
    },
  ]);
  showLoading();

  const myVersion = ++queueRenderVersion;

  let html = "";
  if (localQueue.length > 0) {
    const trackIds = localQueue.map((uri) => uri.split(":")[2]);
    const tracks = await fetchTracksByIds(trackIds);
    if (tracks.length > 0) {
      html = `<h3 class="results-heading">Queue (${tracks.length})</h3>`;
      html += renderLocalQueueItems(tracks);
    }
  }

  if (myVersion !== queueRenderVersion) return;
  document.getElementById("tracks").innerHTML =
    html || '<p class="empty-state">Queue is empty</p>';
}

function renderLocalQueueItems(tracks) {
  return renderItems(tracks, queueTrackMapper);
}

async function playFromLocalQueue(index) {
  const uri = localQueue[index];
  localQueue = localQueue.slice(index + 1);
  saveLocalQueue();
  await playTrack(uri);
  refreshQueueIfViewing();
}

// Queue drag and drop.
let draggedQueueIndex = null;

function onQueueDragStart(e) {
  draggedQueueIndex = parseInt(e.target.dataset.index, 10);
  e.target.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function onQueueDragEnd(e) {
  e.target.classList.remove("dragging");
  for (const el of document.querySelectorAll(".queue-item"))
    el.classList.remove("drag-over");
  draggedQueueIndex = null;
}

function onQueueDragOver(e) {
  e.preventDefault();
  const target = e.target.closest(".queue-item");
  if (target && parseInt(target.dataset.index, 10) !== draggedQueueIndex) {
    target.classList.add("drag-over");
  }
}

function onQueueDragLeave(e) {
  const target = e.target.closest(".queue-item");
  if (target) target.classList.remove("drag-over");
}

function onQueueDrop(e) {
  e.preventDefault();
  const target = e.target.closest(".queue-item");
  if (!target) return;

  const toIndex = parseInt(target.dataset.index, 10);
  if (draggedQueueIndex === null || draggedQueueIndex === toIndex) return;

  const [item] = localQueue.splice(draggedQueueIndex, 1);
  localQueue.splice(toIndex, 0, item);
  saveLocalQueue();
  showQueue();
}

function clearPlayerUI() {
  currentState = null;
  clearInterval(progressInterval);
  updatePlayerUI(null);
}

async function clearQueue() {
  localQueue = [];
  saveLocalQueue();
  await player.pause();
  localStorage.removeItem("play_state");
  clearPlayerUI();
  document.getElementById("tracks").innerHTML =
    '<p class="empty-state">Queue is empty</p>';
}

// Help modal (About + Keyboard Shortcuts).
function showHelp() {
  const shortcuts = [
    ["/", "Search"],
    ["d", "DJ"],
    ["p", "Playlists"],
    ["s", "Saved Albums"],
    ["l", "Liked Songs"],
    ["a", "Top Artists"],
    ["t", "Top Tracks"],
    ["e", "Explore"],
    ["q", "Queue"],
    ["c", "Lyrics"],
    ["Space", "Play / Pause"],
    ["←", "Seek back 10s"],
    ["→", "Seek forward 10s"],
  ];
  const rows = shortcuts
    .map(
      ([key, action]) =>
        `<tr><td style="color:#fff;font-weight:bold;padding:4px 2em 4px 0">${key}</td><td style="color:#b3b3b3;padding:4px 0">${action}</td></tr>`,
    )
    .join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "help-modal";
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.innerHTML = `
    <div class="modal">
      <h2 style="color:#fff">About <span style="color:#1db954">SimpleSpot</span></h2>
      <p>
        A lightweight Spotify client. Almost all the functionality,
        with almost none of the bloat; minimal CPU usage while
        playing, near-zero while idle.
      </p>
      <p style="padding-bottom: 1em"></p>
      <p>
        Uses
        Spotify's <a href="https://developer.spotify.com/documentation/web-api"
        target="_blank" style="color:#1db954">Web</a>
        and <a href="https://developer.spotify.com/documentation/web-playback-sdk"
        target="_blank" style="color:#1db954">Web Playback</a>,
        and <a href="https://lrclib.net/docs" target="_blank"
        style="color:#1db954">LRCLIB</a>'s
        APIs. Requires <a href="https://developer.spotify.com/documentation/web-playback-sdk#:~:text=The%20Web%20Playback%20SDK%20requires%20a%20Spotify%20Premium%20subscription%20(mobile%20only%20types%20of%20premium%20subscriptions%20are%20excluded)"
        target="_blank" style="color:#1db954">Spotify Premium</a>.
      </p>
      <hr style="border:none;border-top:1px solid #444;margin:16px 0">
      <h3 style="margin:0 0 8px;font-size:14px;color:#b3b3b3">Keyboard Shortcuts</h3>
      <table>${rows}</table>
      <button onclick="this.closest('.modal-overlay').remove()">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("button").focus();
}

function hideHelp() {
  const modal = document.getElementById("help-modal");
  if (modal) modal.remove();
}

function setBreadcrumb(items) {
  const el = document.getElementById("breadcrumb");
  if (!items.length) {
    el.style.display = "none";
    document.title = "SimpleSpot";
    return;
  }
  el.style.display = "block";
  el.innerHTML = items
    .map((item, i) =>
      item.action
        ? `<a onclick="${item.action}">${escapeHtml(item.name)}</a>${i < items.length - 1 ? " › " : ""}`
        : `<span>${escapeHtml(item.name)}${item.suffix || ""}</span>`,
    )
    .join("");
  const lastItem = items[items.length - 1];
  document.title = `SimpleSpot - ${lastItem.name}`;
}

// Init.
(async () => {
  assert("mediaSession" in navigator, "navigator.mediaSession missing!");

  document.getElementById("ncspot-note").textContent =
    location.hostname === "127.0.0.1" ? "" : "(more complex login flow)";

  const hasCodeInUrl = new URLSearchParams(window.location.search).has("code");

  // Only process callback if we have a chosen client (i.e., user initiated login).
  const callbackOk =
    hasCodeInUrl && getClientId() ? await handleCallback() : false;

  // If we have ?code= but callback failed, auth flow is broken - start fresh.
  if (hasCodeInUrl && getClientId() && !callbackOk) {
    console.warn("OAuth callback failed, clearing state");
    clearAuth();
    window.history.replaceState({}, "", window.location.href.split("?")[0]);
    return; // Will show login screen.
  }

  // Clear URL params after successful callback.
  if (hasCodeInUrl && callbackOk) {
    window.history.replaceState(
      {},
      "",
      window.location.href.split("/login")[0],
    );
  }

  // Check if we have a valid session.
  if (getClientId() && (callbackOk || getAuth("access_token"))) {
    const tokenExpiry = getAuth("token_expiry");
    const hasRefreshToken = !!getAuth("refresh_token");
    console.log("Init auth check:", {
      // Debugging aid.
      hasAccessToken: !!getAuth("access_token"),
      hasRefreshToken,
      tokenExpiry: tokenExpiry
        ? new Date(parseInt(tokenExpiry, 10)).toISOString()
        : null,
      isExpired: tokenExpiry
        ? Date.now() > parseInt(tokenExpiry, 10)
        : "no expiry",
    });
    if (Date.now() > getAuth("token_expiry")) {
      console.log("Token expired at init, attempting refresh...");
      const refreshed = await refreshToken();
      console.log("Token refresh result:", refreshed);
      if (!refreshed) {
        console.error(
          "Init refresh failed, but have refresh token?",
          hasRefreshToken,
        );
        forceRelogin("init: token refresh failed");
        return;
      }
    }
    document.getElementById("login").style.display = "none";
    document.getElementById("app").classList.add("show");
    loadLocalQueue();
    updateLoopButton();

    if (areDeprecatedFeaturesUnavailable()) {
      const exploreBtn = document.getElementById("nav-explore");
      exploreBtn.disabled = true;
      exploreBtn.style.opacity = "0.4";
      exploreBtn.style.cursor = "not-allowed";
      exploreBtn.title = "Explore (e) - Unavailable";

      const djBtn = document.getElementById("nav-dj");
      djBtn.disabled = true;
      djBtn.style.opacity = "0.4";
      djBtn.style.cursor = "not-allowed";
      djBtn.title = "DJ (d) - Unavailable";
    }

    if (window.Spotify) initPlayer();

    const saved = localStorage.getItem("column_count");
    if (saved) {
      setColumnCount(saved);
      document.getElementById("column-count").value = saved;
    }

    restoreLastView();
  }
})();

function restoreLastView() {
  const lastView = localStorage.getItem("last_view");
  if (!lastView) {
    return showQueue();
  }

  // Search is special: restore from cached results without re-fetching.
  if (lastView === "search") {
    const lastSearch = localStorage.getItem("last_search");
    if (!lastSearch) return showQueue();
    const { query, data } = JSON.parse(lastSearch);
    document.getElementById("search").value = query;
    setBreadcrumb([{ name: `Search: ${query}` }]);
    return renderSearchResults(data);
  }

  // Convert "route:id" format to a navigation state object.
  const [route, id] = lastView.split(":");
  return handleNavigation({ route, params: { id } });
}

function clearSearch() {
  const input = document.getElementById("search");
  input.value = "";
  localStorage.removeItem("last_search");
  if (localStorage.getItem("last_view") !== "queue") showQueue();
  input.focus();
}

document.getElementById("search").addEventListener("keyup", (e) => {
  if (e.key === "Enter" && !e.target.value) {
    localStorage.removeItem("last_search");
    e.target.blur();
  } else if (e.key === "Enter" && e.target.value) {
    search(e.target.value);
    e.target.blur();
  }
});

// Save play state before page unload (before player disconnects and sets paused=true).
window.addEventListener("beforeunload", () => {
  if (!lastPlayState) return;

  // Estimate current position based on elapsed time since last state update.
  if (!lastPlayState.paused)
    lastPlayState.position += Date.now() - lastPlayState.timestamp;
  lastPlayState.timestamp = Date.now();
  localStorage.setItem("play_state", JSON.stringify(lastPlayState));
});

// Refresh token if needed, when tab becomes visible.
document.addEventListener("visibilitychange", async () => {
  if (!navigator.onLine || document.hidden || !getAuth("access_token")) return;
  if (Date.now() > getAuth("token_expiry")) {
    console.log(
      "Tab became visible, token expired, attempting refresh first...",
    );
    const refreshed = await refreshToken();
    if (refreshed) {
      console.log(
        "Token refreshed successfully. If existing player fails to get new access token and playback fails with 4xx consider recreating the player as in the commented code deleted in 306777310f.",
      );
    } else {
      console.error(
        "Token refresh failed on visibility change, reloading page",
      );
      location.reload();
    }
  }
});

function setColumnCount(count) {
  document.documentElement.style.setProperty("--column-count", count);
  localStorage.setItem("column_count", count);
}

// Infinite scroll. Each paginated view sets `pagination` to an object with a
// loadMore() method (via makePagination). The scroll handler calls it.
function makePagination(initialUrl, fetchPage) {
  let nextUrl = initialUrl;
  let loading = false;
  return {
    get active() {
      return !!nextUrl;
    },
    async loadMore() {
      if (!nextUrl || loading) return;
      loading = true;
      const el = document.getElementById("tracks");
      try {
        const rawNext = await fetchPage(nextUrl);
        el.querySelector(".loading-more")?.remove();
        nextUrl = stripApiBase(rawNext);
        if (nextUrl)
          el.insertAdjacentHTML(
            "beforeend",
            '<li class="loading-more">Loading...</li>',
          );
      } finally {
        loading = false;
      }
    },
  };
}

// The scrollable container is .content, not #tracks.
document.querySelector(".content").addEventListener("scroll", function () {
  if (!pagination?.active) return;
  if (this.scrollTop + this.clientHeight >= this.scrollHeight - 200) {
    pagination.loadMore();
  }
});

// Simple key-to-action shortcuts.
const keyboardShortcuts = {
  "?": showHelp,
  q: showQueue,
  p: loadPlaylists,
  l: loadLikedSongs,
  a: loadTopArtists,
  t: loadTopTracks,
  e: loadExplore,
  s: loadSavedAlbums,
  d: playDJ,
  c: toggleLyrics,
};

// Keyboard shortcuts (when not in input).
document.addEventListener("keydown", async (e) => {
  // Escape works even in input fields.
  if (e.key === "Escape") {
    if (e.target.tagName === "INPUT") {
      e.target.blur();
    } else {
      hideHelp();
    }
    return;
  }

  if (e.target.tagName === "INPUT") return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    const state = await player?.getCurrentState();
    if (!state) return;
    const delta = e.code === "ArrowLeft" ? -10000 : 10000;
    const newPos = Math.max(
      0,
      Math.min(state.duration, state.position + delta),
    );
    player.seek(newPos);
  } else if (e.key === "/") {
    e.preventDefault();
    document.getElementById("search").focus();
  } else {
    keyboardShortcuts[e.key]?.();
  }
});

// Media Session API (MPRIS support).
function updateMediaSession(track, state) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.album.name,
    artwork: track.album.images.map((img) => ({
      src: img.url,
      sizes: `${img.width || 300}x${img.height || 300}`,
      type: "image/jpeg",
    })),
  });

  navigator.mediaSession.playbackState = state.paused ? "paused" : "playing";

  // During track loading we get multiple player_state_changed events,
  // some of which carry a "state" object that is not self-consistent
  // (e.g. position>duration). Docs are silent on the subject, but the
  // internet implies that the loading field is a useful signal here
  // (e.g. https://kaltura.github.io/kaltura-player-js/docs/player-states.html#transitions-between-states).
  if (state.duration && state.position <= state.duration && !state.loading) {
    navigator.mediaSession.setPositionState({
      duration: state.duration / 1000,
      position: state.position / 1000,
      playbackRate: 1,
    });
  }
}

function setupMediaSessionHandlers() {
  navigator.mediaSession.setActionHandler("play", () => player?.resume());
  navigator.mediaSession.setActionHandler("pause", () => player?.pause());
  navigator.mediaSession.setActionHandler("previoustrack", previous);
  navigator.mediaSession.setActionHandler("nexttrack", next);
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) {
      player?.seek(details.seekTime * 1000);
    }
  });
}

async function resumePlaybackIfNeeded() {
  const saved = localStorage.getItem("play_state");
  if (!saved) return;

  const state = JSON.parse(saved);

  // Check if last context was DJ playlist.
  const isDJ = state.contextUri === `spotify:playlist:${DJ_PLAYLIST_ID}`;

  if (isDJ) {
    // Show DJ info instead of actual track.
    updatePlayerUI({
      trackName: "DJ",
      artistHtml: "Spotify",
      artUrl: "https://lexicon-assets.spotifycdn.com/DJ-Beta-CoverArt-300.jpg",
      position: 0,
      duration: 0,
      paused: true,
    });
  } else {
    // Fetch track info to update UI.
    const trackData = await api(`/tracks/${state.trackUri.split(":")[2]}`);
    if (trackData) {
      updatePlayerUI({
        trackName: trackData.name,
        trackUri: state.trackUri,
        artistHtml: artistLinksHtml(trackData.artists),
        artUrl: trackData.album.images[0]?.url,
        position: state.position,
        duration: trackData.duration_ms,
        paused: true,
      });
      currentAlbumUri = trackData.album.uri;
    }
  }

  try {
    togglePlay();
  } catch (e) {
    console.log(`AMI: togglePlay triggered: ${e}`);
  }
}
