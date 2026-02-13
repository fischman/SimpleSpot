// Mock infrastructure for SimpleSpot tests.
// This file must be loaded BEFORE app.js.

// --- localStorage mock (isolated per test) ---
const _realLocalStorage = window.localStorage;
let _mockStore = {};

const mockLocalStorage = {
  getItem(key) { return _mockStore[key] ?? null; },
  setItem(key, value) { _mockStore[key] = String(value); },
  removeItem(key) { delete _mockStore[key]; },
  clear() { _mockStore = {}; },
  get length() { return Object.keys(_mockStore).length; },
  key(i) { return Object.keys(_mockStore)[i] ?? null; },
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

// --- navigator.mediaSession mock ---
if (!navigator.mediaSession) {
  navigator.mediaSession = {};
}
navigator.mediaSession.metadata = null;
navigator.mediaSession.playbackState = 'none';
navigator.mediaSession.setPositionState = () => {};
navigator.mediaSession.setActionHandler = () => {};

// --- Fake Spotify Web Playback SDK ---
window.Spotify = {
  Player: class MockPlayer {
    constructor(opts) {
      this._opts = opts;
      this._listeners = {};
      this._state = null;
      this._connected = false;
    }
    addListener(event, cb) {
      (this._listeners[event] = this._listeners[event] || []).push(cb);
    }
    removeListener(event) {
      delete this._listeners[event];
    }
    _emit(event, data) {
      (this._listeners[event] || []).forEach(cb => cb(data));
    }
    connect() {
      this._connected = true;
      // Emit ready after microtask so init code can finish.
      Promise.resolve().then(() => {
        this._emit('ready', { device_id: 'mock-device-id-123' });
      });
      return Promise.resolve(true);
    }
    disconnect() { this._connected = false; }
    async getCurrentState() { return this._state; }
    async togglePlay() {
      if (this._state) this._state.paused = !this._state.paused;
    }
    async resume() {
      if (this._state) this._state.paused = false;
    }
    async pause() {
      if (this._state) this._state.paused = true;
    }
    async seek(posMs) {
      if (this._state) this._state.position = posMs;
    }
    async nextTrack() {}
    async previousTrack() {}
    // Test helper: simulate a player state change.
    _setState(state) {
      this._state = state;
      this._emit('player_state_changed', state);
    }
  },
};

// --- API mock ---
// Routes map endpoint patterns to fixture responses.
// Pattern can be a string (exact match) or RegExp.
const _apiRoutes = [];
let _apiCalls = [];

function mockApiRoute(pattern, response) {
  _apiRoutes.push({ pattern, response });
}

function mockApiReset() {
  _apiRoutes.length = 0;
  _apiCalls = [];
}

function getApiCalls() {
  return _apiCalls;
}

// Pre-seed auth so the app thinks we're logged in.
function seedAuth() {
  _mockStore = {};
  _mockStore['chosen_client'] = 'ncspot';
  const prefix = 'auth_d420a117a32841c2b3474932e49fb54b_';
  _mockStore[prefix + 'access_token'] = 'mock-access-token';
  _mockStore[prefix + 'refresh_token'] = 'mock-refresh-token';
  _mockStore[prefix + 'token_expiry'] = String(Date.now() + 3600000);
}

// Reset all state for a fresh test.
function resetTestState() {
  // Clear mock stores.
  _mockStore = {};
  mockApiReset();

  // Reset app globals that we can access.
  localQueue = [];
  playHistory.length = 0;
  currentTrackUri = null;
  lastTrackUri = null;
  currentState = null;
  currentAlbumUri = null;
  lastPlayState = null;
  loopEnabled = false;
  lyricsEnabled = false;
  currentLyrics = null;
  lyricsTrackKey = null;
  lyricsSynced = false;
  pagination = null;
  queueRenderVersion = 0;
  queueRefreshPending = false;
  playingFromQueueInProgress = false;

  // Reset DOM.
  document.getElementById('tracks').innerHTML = '';
  document.getElementById('breadcrumb').innerHTML = '';
  document.getElementById('breadcrumb').style.display = 'none';
  document.getElementById('player-track').textContent = 'Not playing';
  document.getElementById('player-artist').innerHTML = '';
  document.getElementById('lyrics-view').innerHTML = '';
  document.getElementById('lyrics-view').classList.remove('active');
  document.getElementById('tracks').style.display = '';
  const playBtn = document.getElementById('play-btn');
  playBtn.disabled = true;
  playBtn.style.opacity = '0.5';
  playBtn.textContent = '\u25b6';
}

// --- Override fetch to intercept Spotify API calls ---
const _realFetch = window.fetch;
window.fetch = async function(url, opts) {
  const urlStr = typeof url === 'string' ? url : url.toString();

  // Intercept Spotify API calls.
  if (urlStr.startsWith('https://api.spotify.com/v1')) {
    const endpoint = urlStr.replace('https://api.spotify.com/v1', '');
    _apiCalls.push({ endpoint, opts });

    for (const route of _apiRoutes) {
      const matches = typeof route.pattern === 'string'
        ? endpoint === route.pattern || endpoint.startsWith(route.pattern + '?')
        : route.pattern.test(endpoint);
      if (matches) {
        const body = typeof route.response === 'function'
          ? route.response(endpoint, opts)
          : route.response;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Unmatched API call — return 200 with null to avoid crashes.
    console.warn(`[mock] Unmatched API call: ${endpoint}`);
    return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Intercept Spotify token endpoint.
  if (urlStr.includes('accounts.spotify.com/api/token')) {
    return new Response(JSON.stringify({
      access_token: 'mock-refreshed-token',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'mock-new-refresh-token',
      scope: 'streaming user-read-email',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Let other requests (e.g., lrclib) go through or mock them too.
  if (urlStr.includes('lrclib.net')) {
    return new Response(JSON.stringify({
      syncedLyrics: '[00:10.00]Test lyric line 1\n[00:15.00]Test lyric line 2\n[00:20.00]Test lyric line 3',
      plainLyrics: 'Test lyric line 1\nTest lyric line 2\nTest lyric line 3',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return _realFetch.apply(this, arguments);
};

// --- Pre-seed auth so init IIFE doesn't show login screen ---
seedAuth();

// Prevent the SDK callback from double-initing player.
window.onSpotifyWebPlaybackSDKReady = () => {};

console.log('[mocks] Mock infrastructure loaded.');
