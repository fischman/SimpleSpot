const SIMPLESPOT_CLIENT_ID = "1366988155e64d34b759879f2a575cdd";
const NCSPOT_CLIENT_ID = "d420a117a32841c2b3474932e49fb54b";
const DJ_PLAYLIST_ID = "37i9dQZF1EYkqdzj48dyYq";

// https://developer.spotify.com/documentation/web-api/concepts/scopes
const SCOPES = "streaming user-read-email user-read-private user-library-read user-read-playback-state user-modify-playback-state playlist-read-private user-top-read";

function cloneTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function assert(condition, message) {
  if (condition) {
    return;
  }
  alert("Assertion failed!", message);
  throw new Error(message);
}

function alert(heading, message) {
  const modal = cloneTemplate("template-alert");
  modal.querySelector("#alert-heading").textContent = heading;
  modal.querySelector("#alert-message").textContent = message;
  document.body.appendChild(modal);
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
    case "simplespot":
      return SIMPLESPOT_CLIENT_ID;
    case null:
      return null;
    default:
      assert(false, `Unknown client choice: [${c}]`);
  }
}

function getRedirectUri() {
  if (getClientChoice() === "simplespot") {
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
  return localStorage.getItem("chosen_client") === "simplespot";
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
  ["access_token", "refresh_token", "token_expiry", "code_verifier"].map((k) => localStorage.removeItem(getAuthPrefix() + k));
  localStorage.removeItem("chosen_client");
}

// TODO: review each remaining piece of global state for sanity.

let player = null;
let deviceId = null;
let currentState = null;
let currentAlbumUri = null;

let progressInterval = null;
let lastPlayState = null;
let silentAudio = null;
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
let lastPlayedTrackUri = null;

// Infinite scroll state - single object replaced by each view that supports pagination.
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
  localStorage.setItem("last_view", params.id ? `${route}:${params.id}` : route);
  const state = { route, params };
  if (!isNavigatingBack && JSON.stringify(history.state) !== JSON.stringify(state)) {
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
  for (const b of document.querySelectorAll(".header button.active, .player button.active:not(#loop-btn)")) b.classList.remove("active");
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
  const modal = cloneTemplate("template-ncspot");
  document.body.appendChild(modal);
  document.getElementById("open-spotify-auth").onclick = () => window.open(authUrl, "spotify-auth", "width=500,height=700");
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
  assert(await processAuthCode(code, false, true), "Authentication failed. Please try again.");
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
  assert(navigator.onLine, "Caller must check navigator.onLine before calling refreshToken.");

  // Prevent concurrent refresh attempts.
  if (refreshPromise) {
    console.log("Token refresh already in progress, reusing previous promise...");
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
          console.log("Saving new refresh token received as part of token refresh.");
          setAuth("refresh_token", data.refresh_token);
        }
        return true;
      }
      console.error("Token refresh failed:", data.error, data.error_description, data);
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

const api = (() => {
  const API_CACHE = {};
  const isCacheable = (() => {
    const CACHEABLE_PATHS = new Set(["albums", "playlists", "artists", "tracks", "search", "browse", "/recommendations"]);
    return (endpoint) => {
      endpoint = endpoint.split("?")[0];
      if (endpoint.startsWith("/me/top/")) return true;
      const p = endpoint.split("/");
      if ((p[1] === "users" || p[1] === "/me") && CACHEABLE_PATHS.has(p[3])) return true;
      return CACHEABLE_PATHS.has(p[1]) || CACHEABLE_PATHS.has(p[2]);
    };
  })();
  return async (endpoint, opts = {}, statusHandlers = null) => {
    let key;
    if (isCacheable(endpoint)) {
      key = JSON.stringify({ endpoint, opts });
      const prev = API_CACHE[key];
      if (prev) return prev;
    }
    const val = _api(endpoint, opts, 0, statusHandlers);
    if (key) API_CACHE[key] = val;
    return val;
  };
})();

// _retries: number of previous attempts (used internally for 401/403 refresh and 5xx backoff).
async function _api(endpoint, opts, _retries, statusHandlers) {
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
      return _api(endpoint, opts, 1, statusHandlers);
    } else {
      forceRelogin(`api: token refresh failed after ${res.status}`);
      return null;
    }
  }

  // Retry on 5xx with exponential backoff.
  if (res.status >= 500 && _retries < 3) {
    const delay = 500 * 2 ** _retries;
    console.warn(`Got ${res.status}, retrying ${endpoint} in ${delay}ms (attempt ${_retries + 1}/3)`);
    await new Promise((r) => setTimeout(r, delay)); // a.k.a. "async sleep".
    return _api(endpoint, opts, _retries + 1, statusHandlers);
  }

  if (!res.ok) {
    const handler = statusHandlers?.[res.status];
    if (handler) return handler(res);
    console.error("API error:", res.status, res.statusText, endpoint);
    return null;
  }
  const text = await res.text();
  if (!text) return null;
  try {
    // Do this rather than asking for res.json() above b/c that doesn't distinguish between empty and malformed JSON.
    const json = JSON.parse(text);
    // Filter out restricted tracks so the user never sees unplayable entries.
    if (json?.tracks?.items) {
      json.tracks.total -= json.tracks.items.length;
      json.tracks.items = json.tracks.items.filter((t) => !t?.restrictions || Object.keys(t.restrictions).length === 0);
      json.tracks.total += json.tracks.items.length;
    }
    return json;
  } catch (e) {
    // Don't log for successful responses - some endpoints return non-JSON.
    if (res.status >= 400) {
      console.error("API error response:", res.status, endpoint, text.substring(0, 200), e);
    }
    return null;
  }
}

function stripApiBase(url) {
  return url?.replace("https://api.spotify.com/v1", "") ?? null;
}

// Fetch all pages from a paginated Spotify API endpoint.
async function fetchAllPages(initialUrl, extractItems, extractNext = (data) => data?.next, maxResults = -1) {
  const allItems = [];
  let url = initialUrl;
  while (url && (maxResults < 0 || allItems.length < maxResults)) {
    const data = await api(url);
    const items = extractItems(data);
    allItems.push(...items);
    url = stripApiBase(extractNext(data));
  }
  return allItems;
}

// Fetch tracks by IDs using parallel individual requests.
async function fetchTracksByIds(trackIds) {
  if (!trackIds || trackIds.length === 0) return [];
  return Promise.all(trackIds.map((id) => api(`/tracks/${id}`)));
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

async function disableNativeLooping(deviceId) {
  // Since we manage localQueue and loopEnabled locally, disable
  // Spotify's notion of {track,context} "repeat" mode to avoid
  // confusion.
  await api(`/me/player/repeat?state=off&device_id=${deviceId}`, { method: "PUT" });
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
    volume: (localStorage.getItem("volume") || 100) / 100,
  });

  player.addListener("ready", async ({ device_id }) => {
    deviceId = device_id;
    await disableNativeLooping(deviceId);
    setupMediaSessionHandlers();
    resumePlaybackIfNeeded();
  });

  player.addListener("player_state_changed", (state) => {
    currentState = state;
    if (!state) {
      console.log("Playback transferred to another device.");
      startSilentAudio();
      navigator.mediaSession.playbackState = "paused";
      return updateQueueButtons();
    }
    stopSilentAudio();
    const track = state.track_window.current_track;
    currentAlbumUri = track.album.uri;
    updatePlayerUI({
      trackName: track.name,
      trackUri: track.uri,
      artists: track.artists,
      artUrl: track.album.images[0]?.url,
      position: state.position,
      duration: state.duration,
      paused: state.paused,
    });
    updateProgress();

    clearInterval(progressInterval);
    if (!state.paused) {
      progressInterval = setInterval(updateProgress, 1000);
      if (state.repeat_mode !== 0) disableNativeLooping(deviceId);
    }
    updateMediaSession(track, state);
    updateLoopButton();

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

      // Play next from queue if available.
      if (localQueue.length > 0) {
        playingFromQueueInProgress = true;
        playNextFromLocalQueue().finally(() => {
          playingFromQueueInProgress = false;
        });
      }
    }

    // Skip DJ X's blathering.
    if (state.context?.uri === `spotify:playlist:${DJ_PLAYLIST_ID}` && state.track_window?.current_track?.content_type === "narration") {
      console.log("Skipping DJ narration track!");
      next();
    }
  });

  // Log all
  // https://developer.spotify.com/documentation/web-playback-sdk/reference#events
  // and
  // https://developer.spotify.com/documentation/web-playback-sdk/reference#errors
  // for debugging.
  ["account_error", "authentication_error", "autoplay_failed", "initialization_error", "not_ready", "playback_error", "player_state_changed", "ready"].forEach(
    (eventName) => {
      player.addListener(eventName, (data) => {
        console.log(`[SDK: ${eventName}]`, data);
      });
    },
  );

  player.addListener("autoplay_failed", async ({ _message }) => {
    // On file:// origins the SDK always fires autoplay_failed (opaque origin
    // can't grant autoplay permission), but playback works fine via the Web
    // API transfer in resumePlaybackIfNeeded(). Suppress the overlay.
    if (window.location.protocol === "file:") return;
    const overlay = cloneTemplate("template-autoplay-failed");
    overlay.querySelector("#autoplay-settings-url").textContent = `chrome://settings/content/siteDetails?site=${encodeURIComponent(window.location.origin)}`;
    document.body.appendChild(overlay);
  });

  player.addListener("authentication_error", async ({ message }) => {
    console.log(`authentication_error: ${message}; attempting refresh...`);
    if (!navigator.onLine) {
      console.warn("Offline: ignoring authentication_error, will retry when back online.");
      return;
    }
    if (await refreshToken()) {
      console.log(`Refresh succeeded; now disconnecting, dropping, and re-initPlayer()'ing.`);
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
  const li = document.createElement("li");
  li.className = "empty-state loading-timer";
  li.textContent = "Loading...";
  document.getElementById("tracks").replaceChildren(li);
}

// Centralised player-UI updater. Pass an info object to show track details,
// or null to clear the player to its empty state.
function updatePlayerUI(info) {
  const trackEl = document.getElementById("player-track");
  const artistEl = document.getElementById("player-artist");
  if (info) {
    const trackId = info.trackUri?.split(":")[2];
    trackEl.replaceChildren(trackId ? createShareLinkElement("track", trackId, info.trackName, () => player.seek(0)) : document.createTextNode(info.trackName));
    artistEl.replaceChildren(...createArtistChildren(info));
    const art = document.getElementById("player-art");
    art.src = info.artUrl;
    art.style.display = info.artUrl ? "block" : "none";
    document.getElementById("progress-fill").style.width = info.duration ? `${(info.position / info.duration) * 100}%` : "0%";
    document.getElementById("progress-current").textContent = formatTime(info.position);
    document.getElementById("progress-total").textContent = formatTime(info.duration);
  } else {
    trackEl.textContent = "Not playing";
    artistEl.replaceChildren();
    const art = document.getElementById("player-art");
    art.src = "";
    art.style.display = "none";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("progress-current").textContent = "0:00";
    document.getElementById("progress-total").textContent = "0:00";
  }
  updateQueueButtons();
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  document.getElementById("progress-current").textContent = formatTime(state.position);

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

  // TODO: the remainder of this function has a remarkable amount of
  // duplication and is amenable to a refactor that makes the
  // artist/album/track/playlist attribute generic.
  //
  // TODO: it would be nice to populate the view as results come in
  // (like makePagination and its callers do) instead of the existing
  // wait for all data of all types to load.

  const types = ["artist", "album", "track", "playlist"];

  const results = Object.fromEntries(
    await Promise.all(
      types.map(async (t) => {
        const plural = `${t}s`;
        const allItems = await fetchAllPages(
          `/search?type=${t}&limit=10&q=${encodeURIComponent(q)}`,
          (data) => data[plural]?.items || [],
          (data) => data[plural]?.next,
          50,
        );
        return [plural, { items: allItems }];
      }),
    ),
  );

  localStorage.setItem(
    "last_search",
    // Local storage has a 5MB per-origin limit, so it might seem
    // worrisome to store hundreds of search results
    // here. Experimenting shows that this is not in fact an
    // issue. E.g. searching [queen] results in ~10 Artists
    // and ~50 Albums/Tracks for a total of ~110 records, but
    // localStorage.last_search.length is just 256588. Slimming the
    // results to just the fields used in rendering only reduces this
    // to 51566. Not worth doing.
    JSON.stringify({ query: q, data: results }),
  );
  renderSearchResults(results);
}

function setOptionalTitle(el, title) {
  if (title) {
    el.title = title;
  } else {
    el.removeAttribute("title");
  }
}

function createShareLinkElement(type, id, text, onClick) {
  const link = cloneTemplate("template-share-link");
  link.href = `https://open.spotify.com/${type}/${id}`;
  link.textContent = text;
  link.onclick = (event) => {
    event.preventDefault();
    onClick?.(event);
  };
  return link;
}

function createArtistLinksFragment(artists, onArtistClick = (id) => loadArtist(id), { stopPropagation = false } = {}) {
  const children = [];
  for (const [i, artist] of (artists || []).entries()) {
    if (i > 0) children.push(document.createTextNode(", "));
    const id = artist.id || artist.uri?.split(":")[2] || "";
    if (!id) {
      children.push(document.createTextNode(artist.name || ""));
      continue;
    }
    const wrapper = cloneTemplate("template-artist-link");
    wrapper.appendChild(
      createShareLinkElement("artist", id, artist.name, (event) => {
        if (stopPropagation) event.stopPropagation();
        onArtistClick(id);
      }),
    );
    children.push(wrapper);
  }
  return children;
}

function createArtistChildren(info) {
  if (info.artistText) {
    return [document.createTextNode(info.artistText)];
  }
  return createArtistLinksFragment(info.artists, (id) => loadArtist(id), { stopPropagation: true });
}

function createQueueButtonElement({ text, title, onClick, disabled = false, unavailable = false }) {
  const button = cloneTemplate("template-queue-button");
  button.textContent = text;
  button.title = title;
  button.disabled = disabled;
  if (unavailable) button.classList.add("unavailable");
  button.onclick = (event) => {
    event.stopPropagation();
    onClick?.(event);
  };
  return button;
}

function createRadioButtonElement(type, id) {
  if (areDeprecatedFeaturesUnavailable()) {
    const button = cloneTemplate("template-radio-button");
    button.classList.add("unavailable");
    button.title = "Start radio - Unavailable";
    button.disabled = true;
    return button;
  }
  const button = cloneTemplate("template-radio-button");
  button.title = "Start radio";
  button.onclick = (event) => {
    event.stopPropagation();
    startRadio(type, id);
  };
  return button;
}

function createResultsHeading(text) {
  const heading = cloneTemplate("template-results-heading");
  heading.textContent = text;
  return heading;
}

function createSectionHeader(text) {
  const heading = cloneTemplate("template-section-header");
  heading.textContent = text;
  return heading;
}

function createPlaylistSection(playlists, startNum = 1) {
  const section = cloneTemplate("template-playlist-section");
  section.append(...renderPlaylistSection(playlists, startNum));
  return section;
}

function createEmptyState(message) {
  const el = cloneTemplate("template-empty-state");
  el.textContent = message;
  return el;
}

function createTrackAlbumElement({ text, title, onClick, type = "div", id = "", shareType, shareId }) {
  const el = cloneTemplate("template-track-album");
  setOptionalTitle(el, title);
  if (type === "link") {
    el.appendChild(createShareLinkElement(shareType, shareId, text, onClick));
  } else {
    el.textContent = text;
    if (onClick) el.onclick = onClick;
  }
  if (id) el.id = id;
  return el;
}

function createAlbumDetailElement(data, contextUri) {
  const detail = cloneTemplate("template-album-detail");
  const art = detail.querySelector(".album-detail-art");
  art.title = "Play instead of queue (shift: keep queue)";
  art.onclick = (event) => playContext(contextUri, !event.shiftKey);
  const image = detail.querySelector(".detail-art");
  image.src = data.images?.[1]?.url || "";
  image.alt = data.name || "";
  const title = detail.querySelector(".detail-title");
  title.appendChild(
    createShareLinkElement("album", data.id, data.name, (event) => {
      event.stopPropagation();
      loadAlbum(data.id);
    }),
  );
  detail.querySelector(".album-detail-artists").append(...createArtistLinksFragment(data.artists, (id) => loadArtist(id), { stopPropagation: true }));
  detail.querySelector(".album-detail-summary").textContent = `${data.release_date?.slice(0, 4)} • ${data.total_tracks} tracks`;
  return detail;
}

function createArtistHeroElement(artist) {
  const hero = cloneTemplate("template-artist-hero");
  const image = hero.querySelector(".artist-avatar");
  image.src = artist.images?.[1]?.url || "";
  image.alt = artist.name || "";
  hero.querySelector(".artist-name").appendChild(createShareLinkElement("artist", artist.id, artist.name));
  return hero;
}

// Unified list item renderer. Each caller provides a mapper that returns a
// descriptor; renderItem turns it into a <li>.
function renderItem(d) {
  const li = cloneTemplate("template-track-item");
  if (d.liClass) li.classList.add(...d.liClass.split(" "));
  if (d.liOnclick) li.onclick = d.liOnclick;
  if (d.draggable) {
    li.draggable = true;
    li.ondragstart = onQueueDragStart;
    li.ondragend = onQueueDragEnd;
    li.ondragover = onQueueDragOver;
    li.ondragleave = onQueueDragLeave;
    li.ondrop = onQueueDrop;
  }

  li.querySelector(".track-num").textContent = d.num;
  const numCol = li.querySelector(".track-num-col");
  if (d.queueButton) numCol.appendChild(createQueueButtonElement(d.queueButton));
  if (d.radio) numCol.appendChild(createRadioButtonElement(d.radio.type, d.radio.id));

  const art = li.querySelector(".track-art");
  const image = art.querySelector("img");
  image.src = d.imgSrc || "";
  image.alt = d.name?.text || "";
  if (d.imgStyle) image.style.cssText = d.imgStyle;
  if (d.playAction) {
    art.title = d.playAction.title || "";
    art.onclick = (event) => {
      event.stopPropagation();
      d.playAction.onClick(event);
    };
  } else {
    art.querySelector(".play-overlay").remove();
  }

  const nameEl = li.querySelector(".track-name");
  setOptionalTitle(nameEl, d.name?.title);
  if (d.name?.link) {
    nameEl.appendChild(createShareLinkElement(d.name.link.type, d.name.link.id, d.name.text, d.name.link.onClick));
  } else {
    nameEl.textContent = d.name?.text || "";
  }

  const subtitleEl = li.querySelector(".track-artist");
  setOptionalTitle(subtitleEl, d.subtitle?.title);
  if (d.subtitle?.artists) {
    subtitleEl.append(...createArtistLinksFragment(d.subtitle.artists, (id) => loadArtist(id), { stopPropagation: true }));
  } else {
    subtitleEl.textContent = d.subtitle?.text || "";
  }

  if (d.extraLines?.length) {
    for (const extra of d.extraLines) {
      li.querySelector(".track-info").appendChild(createTrackAlbumElement(extra));
    }
  }

  if (d.suffix) li.appendChild(cloneTemplate(d.suffix.templateId));

  return li;
}

function renderItems(items, mapFn, startNum = 1) {
  return items.map((item, i) => renderItem(mapFn(item, i, startNum + i)));
}

// --- Shared mapper helpers ---

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
    radio: { type: "track", id: trackId },
    imgSrc: t.album?.images?.[2]?.url || "",
    name: { text: t.name, title: t.name },
    subtitle: { artists: t.artists, title: t.artists?.map((a) => a.name).join(", ") || "" },
  };
}

function trackMapper(contextUri, contextOffset = 0) {
  return (t, i, num) => {
    const base = baseTrackFields(t);
    const albumId = t.album?.id || t.album?.uri?.split(":")[2] || "";
    const playAction = {
      onClick: (event) => (contextUri ? playFromContext(contextUri, contextOffset + i, event.shiftKey) : play(t.uri)),
      title: contextUri ? "Play now (shift: drop rest of queue)" : "",
    };
    return {
      ...base,
      num,
      queueButton: {
        text: "+",
        title: "Add to queue (Shift: play next)",
        onClick: (event) => addToQueue([t.uri], event.shiftKey),
      },
      playAction,
      name: {
        ...base.name,
        link: {
          type: "track",
          id: base.trackId,
          onClick: (event) => {
            event.stopPropagation();
            playAction.onClick(event);
          },
        },
      },
      extraLines: t.album
        ? [
            {
              type: "link",
              text: t.album.name,
              title: t.album.name,
              shareType: "album",
              shareId: albumId,
              onClick: (event) => {
                event.stopPropagation();
                loadAlbum(albumId);
              },
            },
          ]
        : [],
    };
  };
}

function albumMapper(a, _i, num) {
  return {
    num,
    queueButton: {
      text: "+",
      title: "Add to queue (Shift: play next)",
      onClick: (event) => addAlbumToQueue(a.id, event.shiftKey),
    },
    radio: { type: "album", id: a.id },
    imgSrc: a.images?.[2]?.url || "",
    playAction: {
      onClick: (event) => playContext(a.uri, !event.shiftKey),
      title: "Play instead of queue (shift: keep queue)",
    },
    name: {
      text: a.name,
      title: a.name,
      link: {
        type: "album",
        id: a.id,
        onClick: (event) => {
          event.stopPropagation();
          loadAlbum(a.id);
        },
      },
    },
    subtitle: { artists: a.artists, title: a.artists?.map((x) => x.name).join(", ") || "" },
    liOnclick: () => loadAlbum(a.id),
  };
}

function discographyAlbumMapper(a, i, num) {
  return {
    ...albumMapper(a, i, num),
    subtitle: { text: `${a.album_type} \u2022 ${a.release_date?.slice(0, 4)}` },
  };
}

function playlistMapper(p, _i, num) {
  return {
    num,
    queueButton: {
      text: "+",
      title: "Add to queue (Shift: play next)",
      onClick: (event) => addPlaylistToQueue(p.id, event.shiftKey),
    },
    radio: { type: "playlist", id: p.id },
    imgSrc: p.images?.[0]?.url || "",
    playAction: {
      onClick: (event) => playContext(`spotify:playlist:${p.id}`, !event.shiftKey),
      title: "Play instead of queue (shift: keep queue)",
    },
    name: {
      text: p.name,
      title: p.name,
      link: {
        type: "playlist",
        id: p.id,
        onClick: (event) => {
          event.stopPropagation();
          loadPlaylist(p.id);
        },
      },
    },
    subtitle: { text: `${(p.items ?? p.tracks).total} tracks` },
    liOnclick: () => loadPlaylist(p.id),
  };
}

function playlistSectionMapper(p, i, num) {
  return {
    ...playlistMapper(p, i, num),
    subtitle: { text: stripHtml(p.description || "") },
  };
}

function artistMapper(a, _i, num) {
  return {
    num,
    radio: { type: "artist", id: a.id },
    imgSrc: a.images?.[2]?.url || a.images?.[0]?.url || "",
    imgStyle: "border-radius:50%",
    name: {
      text: a.name,
      title: a.name,
      link: {
        type: "artist",
        id: a.id,
        onClick: (event) => {
          event.stopPropagation();
          loadArtist(a.id);
        },
      },
    },
    subtitle: { text: a.genres?.slice(0, 2).join(", ") || "", title: a.genres?.slice(0, 2).join(", ") || "" },
    liOnclick: () => loadArtist(a.id),
  };
}

// Get the queue index of an element by its position among .queue-item siblings.
function queueIndexOf(el) {
  const li = el.closest(".queue-item");
  if (!li) return -1;
  return [...li.parentElement.querySelectorAll(".queue-item")].indexOf(li);
}

function queueTrackMapper(t) {
  return {
    ...baseTrackFields(t),
    num: "",
    queueButton: {
      text: "\u2212",
      title: "Remove from queue",
      onClick: (event) => removeFromQueue(queueIndexOf(event.currentTarget)),
    },
    playAction: {
      onClick: (event) => playFromLocalQueue(queueIndexOf(event.currentTarget)),
    },
    name: {
      text: t.name,
      title: t.name,
      link: {
        type: "track",
        id: t.id,
        onClick: (event) => {
          event.stopPropagation();
          playFromLocalQueue(queueIndexOf(event.currentTarget));
        },
      },
    },
    extraLines: t.album
      ? [
          {
            text: t.album.name,
            title: t.album.name,
            onClick: (event) => {
              event.stopPropagation();
              loadAlbum(t.album.id);
            },
          },
        ]
      : [],
    liClass: "queue-item",
    draggable: true,
    suffix: { templateId: "template-drag-handle" },
  };
}

// --- Render functions (thin wrappers) ---

function renderTrackItems(tracks, contextUri, startNum = 1, contextOffset = 0) {
  return renderItems(tracks, trackMapper(contextUri, contextOffset), startNum);
}

function renderPlaylistItems(playlists, contextUri, startNum = 1, contextOffset = 0) {
  return renderItems(playlists, playlistMapper(contextUri, contextOffset), startNum);
}

function renderSearchResults(data) {
  const el = document.getElementById("tracks");
  pagination = null;
  paginationGen++;
  const children = [];
  if (data.artists?.items.length) {
    children.push(createResultsHeading("Artists"), ...renderItems(data.artists.items, artistMapper));
  }
  if (data.albums?.items.length) {
    children.push(createResultsHeading("Albums"), ...renderItems(data.albums.items, albumMapper));
  }
  if (data.tracks?.items.length) {
    children.push(createResultsHeading("Tracks"), ...renderTrackItems(data.tracks.items, null));
  }
  if (data.playlists?.items.length) {
    children.push(createResultsHeading("Playlists"), ...renderItems(data.playlists.items, playlistMapper));
  }
  el.replaceChildren(...children);
}

async function _play(body) {
  assert(deviceId, "No device ID - player not ready");
  return api(`/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function play(uri, position_ms = 0) {
  if (loopEnabled && lastPlayedTrackUri && localQueue.at(-1) !== lastPlayedTrackUri) {
    // Prevent duplicates being added through callpaths to us that
    // didn't consume a whole track (e.g. previous(), spurious
    // player_state_changed callbacks, resumePlaybackIfNeeded, etc).
    localQueue.push(lastPlayedTrackUri);
    lastPlayedTrackUri = null;
    saveLocalQueue();
  }
  lastPlayedTrackUri = uri;
  await _play({ uris: [uri], position_ms });
}

// Fetch tracks from album/playlist and add to front of queue.
async function playContext(uri, clearQueue = false) {
  return playFromContext(uri, 0, clearQueue);
}

// Play specific track and queue the rest from that position.
async function playFromContext(uri, offset, clearQueue = false) {
  const [, type, id] = uri.split(":");
  let trackUris = [];

  if (type === "album") {
    const album = await api(`/albums/${id}`);
    trackUris = album?.tracks?.items?.map((t) => t.uri).filter(Boolean) || [];
  } else if (type === "playlist") {
    trackUris = await fetchAllPages(`/playlists/${id}/items?limit=100`, (data) => (data?.items || []).map((i) => i.item?.uri).filter(Boolean));
  }

  if (trackUris.length === 0) return;

  // Start from offset position.
  const tracksFromOffset = trackUris.slice(offset);
  if (clearQueue) lastPlayedTrackUri = null;
  localQueue = clearQueue ? tracksFromOffset : tracksFromOffset.concat(localQueue);
  saveLocalQueue();
  await showQueue();
  await playNextFromLocalQueue();
}

async function playDJ() {
  await _play({ context_uri: `spotify:playlist:${DJ_PLAYLIST_ID}` });
}

function saveLocalQueue() {
  localStorage.setItem("local_queue", JSON.stringify(localQueue));
}

function loadLocalQueue() {
  localQueue = JSON.parse(localStorage.getItem("local_queue")) || [];
  updateQueueButtons();
}

// Single owner of play/next/prev button enabled state.
function updateQueueButtons() {
  const isDJ = currentState?.context.uri === `spotify:playlist:${DJ_PLAYLIST_ID}`;
  const isPlaying = currentState && !currentState.paused;
  const hasQueue = localQueue.length > 0;
  const hasHistory = playHistory.length > 0;
  const playBtn = document.getElementById("play-btn");
  const nextBtn = document.getElementById("next-btn");
  const prevBtn = document.getElementById("prev-btn");
  assert(playBtn && nextBtn && prevBtn, "Missing button!");
  const canPlay = isPlaying || hasQueue;
  const canNext = hasQueue || isDJ;
  const canPrev = hasHistory || isDJ;
  playBtn.disabled = !canPlay;
  playBtn.style.opacity = canPlay ? "1" : "0.5";
  playBtn.textContent = isPlaying ? "⏸" : "▶";
  nextBtn.disabled = !canNext;
  nextBtn.style.opacity = canNext ? "1" : "0.5";
  prevBtn.disabled = !canPrev;
  prevBtn.style.opacity = canPrev ? "1" : "0.5";
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
  const trackUris = await fetchAllPages(`/playlists/${playlistId}/items?limit=100`, (data) => (data?.items || []).map((i) => i.item?.uri).filter(Boolean));
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
  const isDJ = currentState?.context.uri === `spotify:playlist:${DJ_PLAYLIST_ID}`;
  const btn = document.getElementById("loop-btn");
  btn.disabled = isDJ;
  btn.style.opacity = isDJ ? "0.4" : "";
  btn.style.cursor = isDJ ? "not-allowed" : "";
  btn.title = isDJ ? "Loop (unavailable during DJ)" : "Loop";
  btn.classList.toggle("active", loopEnabled);
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

const fetchLyrics = (() => {
  const lyricsCache = {};
  return async (url) => {
    if (url in lyricsCache) {
      return lyricsCache[url];
    }
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      console.error(`fetch(${url}):`, e);
      return undefined;
    }
    if (res.status === 404) {
      lyricsCache[url] = undefined;
      return undefined;
    }
    if (!res.ok) return undefined;
    const data = await res.json();
    lyricsCache[url] = data;
    return data;
  };
})();

async function fetchAndShowLyrics() {
  const lyricsView = document.getElementById("lyrics-view");
  if (!lastPlayState?.trackUri) {
    lyricsView.replaceChildren(cloneTemplate("template-lyrics-no-track"));
    return;
  }

  const trackName = document.getElementById("player-track")?.textContent || "";
  const artistName = document.getElementById("player-artist")?.textContent || "";
  const trackKey = `${artistName} ${trackName}`;

  if (trackKey === lyricsTrackKey && currentLyrics) {
    renderLyrics();
    return;
  }

  lyricsTrackKey = trackKey;
  lyricsView.replaceChildren(cloneTemplate("template-lyrics-loading"));

  const duration = Math.round(currentState?.duration / 1000);
  const durationParam = duration ? `&duration=${duration}` : "";
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}${durationParam}`;
  const data = await fetchLyrics(url);
  if (!data) {
    currentLyrics = null;
    lyricsView.replaceChildren(cloneTemplate("template-lyrics-no-lyrics"));
    return;
  }

  if (data?.syncedLyrics) {
    // Parse LRC format: [mm:ss.xx]text.
    lyricsSynced = true;
    currentLyrics = data.syncedLyrics
      .split("\n")
      .map((line) => {
        const match = line.match(/^\[(\d+):(\d+\.\d+)\](.*)$/);
        if (!match) return null;
        const time = parseInt(match[1], 10) * 60000 + parseFloat(match[2]) * 1000;
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
      words: "[missing time-sync data for these lyrics 😕]",
      isNotice: true,
    });
  } else {
    currentLyrics = null;
    lyricsView.replaceChildren(cloneTemplate("template-lyrics-no-lyrics"));
    return;
  }

  renderLyrics();
}

function renderLyrics() {
  const lyricsView = document.getElementById("lyrics-view");
  if (!currentLyrics || currentLyrics.length === 0) {
    lyricsView.replaceChildren(cloneTemplate("template-lyrics-no-lyrics"));
    return;
  }

  const track = currentState?.track_window?.current_track;
  const content = cloneTemplate("template-lyrics-content");
  const title = content.querySelector(".lyrics-title");
  const trackName = content.querySelector(".lyrics-track-name");
  const artistNames = content.querySelector(".lyrics-artist-names");
  const albumName = content.querySelector(".lyrics-album-name");
  const artistSeparator = content.querySelector(".lyrics-separator-artist");
  const albumSeparator = content.querySelector(".lyrics-separator-album");
  const linesContainer = content.querySelector(".lyrics-lines");

  if (track) {
    trackName.textContent = track.name;
    artistNames.textContent = track.artists.map((artist) => artist.name).join(", ");
    albumName.textContent = track.album.name;
  } else {
    title.textContent = "";
    artistSeparator.remove();
    albumSeparator.remove();
  }

  for (const line of currentLyrics) {
    const lineEl = cloneTemplate("template-lyric-line");
    if (!lyricsSynced) lineEl.classList.add("plain");
    if (line.isNotice) {
      lineEl.style.marginTop = "2em";
      lineEl.style.marginBottom = "2em";
    }
    if (lyricsSynced) {
      lineEl.dataset.time = line.time;
      lineEl.onclick = () => seekToLyric(line.time);
      lineEl.textContent = line.words || "\u266a";
    } else {
      lineEl.textContent = line.words || "";
    }
    linesContainer.appendChild(lineEl);
  }

  lyricsView.replaceChildren(content);

  if (lyricsSynced) updateLyricsHighlight();
}

function seekToLyric(timeMs) {
  if (player) player.seek(timeMs);
}

function updateLyricsHighlight() {
  if (!lyricsEnabled || !currentLyrics || !lastPlayState || !lyricsSynced) return;

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
  await play(nextUri);
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
  if (s.trackUri) {
    return await play(s.trackUri, s.position || 0);
  }
}

async function next() {
  const state = await player?.getCurrentState();
  if (state?.context.metadata.context_description === "DJ") {
    return player.nextTrack();
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
  lastPlayedTrackUri = null; // Avoid confusion during looping.

  if (state?.context.metadata.context_description === "DJ") {
    return player.previousTrack();
  }

  if (playHistory.length === 0) return;

  if (currentTrackUri && localQueue.at(0) !== currentTrackUri) {
    localQueue.unshift(currentTrackUri);
    saveLocalQueue();
  }
  currentTrackUri = null;

  // Play previous track from history.
  const prevUri = playHistory.pop();
  if (loopEnabled && prevUri === localQueue.at(-1)) {
    localQueue.pop();
    saveLocalQueue();
  }
  await play(prevUri);
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
  const children = data.devices.map((d) => {
    const item = cloneTemplate("template-device-item");
    item.textContent = d.name;
    item.onclick = () => transferPlayback(d.id);
    if (d.is_active) item.classList.add("active");
    return item;
  });

  if (data.devices.length <= 1) {
    children.push(cloneTemplate("template-device-help"));
  }

  menu.replaceChildren(...children);
}

function toggleDevices() {
  const menu = document.getElementById("device-menu");
  menu.classList.toggle("show");
  if (menu.classList.contains("show")) loadDevices();
}

async function transferPlayback(id, play = true) {
  await api(
    "/me/player",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [id], play }),
    },
    id !== deviceId
      ? null
      : {
          404: () => {
            console.warn("transferPlayback: 404, device invalidated - recreating player");
            player.disconnect();
            player = null;
            initPlayer();
          },
        },
  );
  document.getElementById("device-menu").classList.remove("show");
}

async function loadPaginatedView({ route, breadcrumb, url, extractItems, renderItems }) {
  navigate(route);
  setBreadcrumb(breadcrumb);
  const el = document.getElementById("tracks");
  el.classList.add("grid-view");
  showLoading();
  document.querySelector(".content").scrollTop = 0;

  let count = 0;
  const gen = paginationGen;
  const p = makePagination(url, async (nextUrl) => {
    const data = await api(nextUrl);
    if (gen !== paginationGen) return null; // View changed, stop.
    const items = extractItems(data);
    if (!count) el.replaceChildren();
    el.append(...renderItems(items, count + 1));
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
    extractItems: (data) => (data.items || []).map((i) => i.track).filter(Boolean),
    renderItems: (tracks, n) => renderTrackItems(tracks, null, n),
  });
}

async function loadSavedAlbums() {
  return loadPaginatedView({
    route: "albums",
    breadcrumb: [{ name: "Saved Albums" }],
    url: "/me/albums?limit=50",
    extractItems: (data) => (data.items || []).map((i) => i.album).filter(Boolean),
    renderItems: (albums, n) => renderItems(albums, albumMapper, n),
  });
}

async function loadPlaylists() {
  return loadPaginatedView({
    route: "playlists",
    breadcrumb: [{ name: "Playlists" }],
    url: "/me/playlists?limit=50",
    extractItems: (data) => (data.items || []).filter((p) => p && p.id !== DJ_PLAYLIST_ID),
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
  showLoading();
  document.querySelector(".content").scrollTop = 0;

  const gen = paginationGen;
  exploreSeenIds = new Set();

  // Search for personalized playlists.
  const personalizedSearches = ["Release Radar", "Discover Weekly", "Daily Mix 1", "Daily Mix 2", "Daily Mix 3", "Daily Mix 4", "Daily Mix 5", "Daily Mix 6"];

  // Start all fetches in parallel.
  // (Note that unlike e.g. DJ, these playlists have per-user IDs, so must fetch and can't hardcode).
  const mixesPromise = Promise.all(personalizedSearches.map((q) => api(`/search?type=playlist&limit=1&q=${encodeURIComponent(q)}`)));
  const madeForYouPromise = api("/browse/categories/0JQ5DAt0tbjZptfcdMSKl3/playlists?limit=50");
  const featuredPromise = api("/browse/featured-playlists?limit=50");

  // Render Your Mixes as soon as ready.
  const searchResults = await mixesPromise;
  const personalizedPlaylists = [];
  personalizedSearches.forEach((searchName, idx) => {
    const results = searchResults[idx]?.playlists?.items || [];
    const match =
      results.find((p) => p.name.toLowerCase() === searchName.toLowerCase() && p.owner?.id === "spotify") ||
      results.find((p) => p.name.toLowerCase().startsWith(searchName.toLowerCase()));
    if (match && !exploreSeenIds.has(match.id)) {
      personalizedPlaylists.push(match);
      exploreSeenIds.add(match.id);
    }
  });
  el.replaceChildren();
  if (personalizedPlaylists.length > 0) {
    el.append(createSectionHeader("Your Mixes"), createPlaylistSection(personalizedPlaylists, 1));
  }

  // Render Made For You as soon as ready.
  const madeForYouData = await madeForYouPromise;
  const madeForYouPlaylists = (madeForYouData?.playlists?.items || []).filter((p) => p && !exploreSeenIds.has(p.id));
  for (const p of madeForYouPlaylists) exploreSeenIds.add(p.id);
  if (madeForYouPlaylists.length > 0) {
    el.append(createSectionHeader("Made For You"), createPlaylistSection(madeForYouPlaylists, 1));
  }

  // Render Featured Playlists, paginating.
  let featuredCount = 0;
  const featuredData = await featuredPromise;
  const items = (featuredData?.playlists?.items || []).filter((p) => p && !exploreSeenIds.has(p.id));
  for (const p of items) exploreSeenIds.add(p.id);
  featuredCount += items.length;

  // Render first batch immediately.
  const featuredSection = createPlaylistSection(items, 1);
  featuredSection.id = "featured-section";
  el.append(createSectionHeader("Featured Playlists"), featuredSection);

  // Paginate Featured playlists (eagerly up to 300, then infinite scroll).
  const featuredUrl = stripApiBase(featuredData?.playlists?.next);
  const p = !featuredUrl
    ? null
    : makePagination(featuredUrl, async (nextUrl) => {
        const data = await api(nextUrl);
        if (gen !== paginationGen) return null;
        const newItems = (data.playlists?.items || []).filter((p) => p && !exploreSeenIds.has(p.id));
        if (newItems.length > 0) {
          document.getElementById("featured-section").append(...renderPlaylistSection(newItems, featuredCount + 1));
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

  setBreadcrumb([{ name: "Playlists", action: loadPlaylists }, { name: "Loading..." }]);

  showLoading();
  const contextUri = `spotify:playlist:${id}`;

  const [_, allTracks] = await Promise.all([
    api(`/playlists/${id}`).then((d) => {
      setBreadcrumb([{ name: "Playlists", action: loadPlaylists }, { name: d.name || "Playlist" }]);
    }),
    fetchAllPages(`/playlists/${id}/items?limit=50`, (data) => (data?.items || []).map((i) => i.item).filter(Boolean)),
  ]);
  document.getElementById("tracks").replaceChildren(...renderTrackItems(allTracks, contextUri));
}

async function loadAlbum(id) {
  navigate("album", { id });
  showLoading();
  const data = await api(`/albums/${id}`);
  setBreadcrumb([{ name: `Album: ${data.name}` }]);
  const contextUri = data.uri;
  const tracks = data.tracks.items.map((t) => ({
    ...t,
    album: { id: data.id, name: data.name, images: data.images },
  }));
  const clear = document.createElement("div");
  clear.style.clear = "left";
  document.getElementById("tracks").replaceChildren(createAlbumDetailElement(data, contextUri), clear, ...renderTrackItems(tracks, contextUri));
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
  const children = [createArtistHeroElement(artist)];

  if (topTracks.tracks?.length) {
    children.push(createResultsHeading("Top Tracks"), ...renderTrackItems(topTracks.tracks.slice(0, 5), null));
  }

  const firstAlbums = albumsData.items || [];
  const nextAlbumsUrl = stripApiBase(albumsData.next);
  const remainingAlbums = nextAlbumsUrl ? await fetchAllPages(nextAlbumsUrl, (data) => data.items || []) : [];
  const allAlbums = firstAlbums.concat(remainingAlbums);
  if (allAlbums.length) {
    children.push(createResultsHeading("Discography"), ...renderAlbumItems(allAlbums, 1));
  }

  el.replaceChildren(...children);
}

async function showQueue() {
  navigate("queue");
  setBreadcrumb([
    {
      name: "Queue",
      suffixTemplateId: "template-breadcrumb-clear-button",
      suffixSetup: (el) => {
        el.onclick = () => clearQueue();
      },
    },
  ]);
  showLoading();

  const myVersion = ++queueRenderVersion;

  const children = [];
  if (localQueue.length > 0) {
    const trackIds = localQueue.map((uri) => uri.split(":")[2]);
    let tracks = await fetchTracksByIds(trackIds);
    // Remove unavailable tracks (Spotify returns null for deleted tracks).
    if (tracks.some((t) => !t)) {
      localQueue = localQueue.filter((_, i) => tracks[i]);
      tracks = tracks.filter(Boolean);
      saveLocalQueue();
    }
    if (tracks.length > 0) {
      const heading = createResultsHeading("Queue");
      heading.id = "queue-heading";
      children.push(heading, ...renderLocalQueueItems(tracks));
    }
  }

  if (myVersion !== queueRenderVersion) return;
  document.getElementById("tracks").replaceChildren(...(children.length ? children : [createEmptyState("Queue is empty")]));
}

function updateQueueCount() {
  const heading = document.getElementById("queue-heading");
  if (!heading) return;
  const count = document.querySelectorAll("#tracks .queue-item").length;
  heading.textContent = `Queue (${count})`;
}

// Keep queue heading count in sync when items are added/removed.
new MutationObserver(updateQueueCount).observe(document.getElementById("tracks"), { childList: true });

function renderLocalQueueItems(tracks) {
  return renderItems(tracks, queueTrackMapper);
}

async function playFromLocalQueue(index) {
  const uri = localQueue[index];
  localQueue = localQueue.slice(index + 1);
  saveLocalQueue();
  await play(uri);
  refreshQueueIfViewing();
}

// Queue drag and drop.
let draggedQueueIndex = null;

function onQueueDragStart(e) {
  draggedQueueIndex = queueIndexOf(e.target);
  e.target.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function onQueueDragEnd(e) {
  e.target.classList.remove("dragging");
  for (const el of document.querySelectorAll(".queue-item")) el.classList.remove("drag-over");
  draggedQueueIndex = null;
}

function onQueueDragOver(e) {
  e.preventDefault();
  const target = e.target.closest(".queue-item");
  if (target && queueIndexOf(target) !== draggedQueueIndex) {
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

  const toIndex = queueIndexOf(target);
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
  document.getElementById("tracks").replaceChildren(createEmptyState("Queue is empty"));
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
  const overlay = cloneTemplate("template-help");
  const table = overlay.querySelector("#help-shortcuts");
  for (const [key, action] of shortcuts) {
    const row = cloneTemplate("template-help-shortcut-row");
    row.querySelector(".help-shortcut-key").textContent = key;
    row.querySelector(".help-shortcut-action").textContent = action;
    table.appendChild(row);
  }
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
  const children = [];
  for (const [i, item] of items.entries()) {
    const content = cloneTemplate(item.action ? "template-breadcrumb-link" : "template-breadcrumb-text");
    content.textContent = item.name;
    if (item.action) content.onclick = item.action;
    if (item.suffixTemplateId) {
      const suffix = cloneTemplate(item.suffixTemplateId);
      item.suffixSetup?.(suffix);
      content.appendChild(suffix);
    }
    children.push(content);
    if (i < items.length - 1) {
      children.push(cloneTemplate("template-breadcrumb-separator"));
    }
  }
  el.replaceChildren(...children);
  const lastItem = items[items.length - 1];
  document.title = `SimpleSpot - ${lastItem.name}`;
}

// Init.
(async () => {
  assert("mediaSession" in navigator, "navigator.mediaSession missing!");

  const slider = document.getElementById("volume-slider");
  const saved = localStorage.getItem("volume");
  if (saved) {
    slider.value = saved;
    slider.title = `Volume: ${saved}%`;
  }
  slider.addEventListener("input", () => {
    slider.title = `Volume: ${slider.value}%`;
  });
  slider.addEventListener("change", () => {
    localStorage.setItem("volume", slider.value);
    player?.setVolume(slider.value / 100);
  });

  document.getElementById("ncspot-note").textContent = location.hostname === "127.0.0.1" ? "" : "(more complex login flow)";

  const hasCodeInUrl = new URLSearchParams(window.location.search).has("code");

  // Only process callback if we have a chosen client (i.e., user initiated login).
  const callbackOk = hasCodeInUrl && getClientId() ? await handleCallback() : false;

  // If we have ?code= but callback failed, auth flow is broken - start fresh.
  if (hasCodeInUrl && getClientId() && !callbackOk) {
    console.warn("OAuth callback failed, clearing state");
    clearAuth();
    window.history.replaceState({}, "", window.location.href.split("?")[0]);
    return; // Will show login screen.
  }

  // Clear URL params after successful callback.
  if (hasCodeInUrl && callbackOk) {
    window.history.replaceState({}, "", window.location.href.split("/login")[0]);
  }

  // Check if we have a valid session.
  if (getClientId() && (callbackOk || getAuth("access_token"))) {
    const tokenExpiry = getAuth("token_expiry");
    const hasRefreshToken = !!getAuth("refresh_token");
    console.log("Init auth check:", {
      // Debugging aid.
      hasAccessToken: !!getAuth("access_token"),
      hasRefreshToken,
      tokenExpiry: tokenExpiry ? new Date(parseInt(tokenExpiry, 10)).toISOString() : null,
      isExpired: tokenExpiry ? Date.now() > parseInt(tokenExpiry, 10) : "no expiry",
    });
    if (Date.now() > getAuth("token_expiry")) {
      console.log("Token expired at init, attempting refresh...");
      const refreshed = await refreshToken();
      console.log("Token refresh result:", refreshed);
      if (!refreshed) {
        console.error("Init refresh failed, but have refresh token?", hasRefreshToken);
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

function savePlayState() {
  if (!lastPlayState) return;
  // Estimate current position based on elapsed time since last state update.
  if (!lastPlayState.paused) lastPlayState.position += Date.now() - lastPlayState.timestamp;
  lastPlayState.timestamp = Date.now();
  localStorage.setItem("play_state", JSON.stringify(lastPlayState));
}

// Save play state before page unload (before player disconnects and sets paused=true).
window.addEventListener("beforeunload", savePlayState);
window.addEventListener("offline", savePlayState);

// Refresh token if needed, when tab becomes visible.
document.addEventListener("visibilitychange", async () => {
  if (!navigator.onLine || document.hidden || !getAuth("access_token")) return;
  if (Date.now() > getAuth("token_expiry")) {
    console.log("Tab became visible, token expired, attempting refresh first...");
    const refreshed = await refreshToken();
    if (refreshed) {
      console.log(
        "Token refreshed successfully. If existing player fails to get new access token and playback fails with 4xx consider recreating the player as in the commented code deleted in 306777310f.",
      );
    } else {
      console.error("Token refresh failed on visibility change, reloading page");
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
        if (nextUrl) el.appendChild(cloneTemplate("template-loading-more"));
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

// Keyboard shortcuts (when not in input).
document.addEventListener(
  "keydown",
  ((shortcuts) => async (e) => {
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
      const newPos = Math.max(0, Math.min(state.duration, state.position + delta));
      player.seek(newPos);
    } else if (e.key === "/") {
      e.preventDefault();
      document.getElementById("search").focus();
    } else {
      shortcuts[e.key]?.();
    }
  })({
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
  }),
);

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
  navigator.mediaSession.setActionHandler("play", () => {
    if (currentState) return player?.resume();
    // After transfer to another device, "play" should transfer back to us.
    return transferPlayback(deviceId, true);
  });
  navigator.mediaSession.setActionHandler("pause", () => {
    if (currentState) return player?.pause();
    // "Pause" on silentAudio means a play/pause event fired, so take playback back.
    if (silentAudio) return transferPlayback(deviceId, true);
  });
  navigator.mediaSession.setActionHandler("previoustrack", previous);
  navigator.mediaSession.setActionHandler("nexttrack", next);
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) {
      player?.seek(details.seekTime * 1000);
    }
  });
}

// Keep Chrome's media session alive when playback transfers to another device.
// Chrome ties media session lifetime to an active audio element; without one,
// media key events stop routing to us. Loop a single-sample silent WAV.
function startSilentAudio() {
  if (silentAudio) return;
  // Regenerate with: b=new ArrayBuffer(46);d=new DataView(b);[...'RIFF'].forEach((c,i)=>d.setUint8(i,c.charCodeAt()));d.setUint32(4,38,!0);[...'WAVEfmt '].forEach((c,i)=>d.setUint8(8+i,c.charCodeAt()));d.setUint32(16,16,!0);d.setUint16(20,1,!0);d.setUint16(22,1,!0);d.setUint32(24,8000,!0);d.setUint32(28,16000,!0);d.setUint16(32,2,!0);d.setUint16(34,16,!0);[...'data'].forEach((c,i)=>d.setUint8(36+i,c.charCodeAt()));d.setUint32(40,2,!0);'data:audio/wav;base64,'+btoa(String.fromCharCode(...new Uint8Array(b)))
  const audio = new Audio("data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==");
  audio.loop = true;
  audio.play().catch((e) => console.warn("Silent audio play failed:", e));
  silentAudio = audio;
  console.log("Silent audio started to keep media session alive.");
}
function stopSilentAudio() {
  if (!silentAudio) return;
  silentAudio.pause(); // Immediately stop playback without waiting for silentAudio to be GC'd.
  silentAudio = null;
  console.log("Silent audio stopped.");
}

async function resumePlaybackIfNeeded() {
  savePlayState(); // No-op on new page load, but ensures we use lastPlayState if available (e.g. during offline->online transition).

  const saved = localStorage.getItem("play_state");
  if (!saved) {
    await transferPlayback(deviceId, false);
    return;
  }

  const state = JSON.parse(saved);

  // Check if last context was DJ playlist.
  const isDJ = state.contextUri === `spotify:playlist:${DJ_PLAYLIST_ID}`;

  if (isDJ) {
    // Show DJ info instead of actual track.
    updatePlayerUI({
      trackName: "DJ",
      artistText: "Spotify",
      artUrl: "https://lexicon-assets.spotifycdn.com/DJ-Beta-CoverArt-300.jpg",
      position: 0,
      duration: 0,
      paused: state.paused,
    });
    if (!state.paused) {
      await playDJ();
    } else {
      await transferPlayback(deviceId, false);
    }
    return;
  }

  // Fetch track info to update UI.
  const trackData = await api(`/tracks/${state.trackUri.split(":")[2]}`);
  if (trackData) {
    updatePlayerUI({
      trackName: trackData.name,
      trackUri: state.trackUri,
      artists: trackData.artists,
      artUrl: trackData.album.images[0]?.url,
      position: state.position,
      duration: trackData.duration_ms,
      paused: true,
    });
    currentAlbumUri = trackData.album.uri;
  }
  if (!state.paused) {
    await play(state.trackUri, state.position || 0);
  } else {
    await transferPlayback(deviceId, false);
  }
}
