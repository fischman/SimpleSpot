# SimpleSpot Architecture

## Overview

SimpleSpot is a simple web-based Spotify client implemented in two files (~2700 lines total). It uses Spotify's Web API and Web Playback SDK to provide playback control, library browsing, and queue management.

## Key Design Decisions

### Minimal File Architecture
The application is split into two files:
- `index.html` (~230 lines) - HTML structure and CSS styles
- `app.js` (~2500 lines) - All JavaScript application logic

This enables easy deployment while keeping concerns separated.

### Client ID Support
Two Spotify client IDs are supported:
- **playpause**: Default, uses standard OAuth redirect flow
- **ncspot**: Alternative, requires manual URL copy/paste due to `http://127.0.0.1` redirect URI

Set `USE_NCSPOT = true/false` at top of script to switch. Auth tokens are namespaced by client ID in localStorage (`auth_<client_id>_*`).

### Authentication
- OAuth 2.0 PKCE flow (no server-side secret needed)
- Tokens stored in localStorage with client ID prefix
- Automatic token refresh with 60-second buffer before expiry
- Refresh token rotation support (saves new refresh token if Spotify issues one)
- Player recreated on auth errors to get fresh token

### Playback Model

SimpleSpot uses a **queue-only playback model**:

1. **Playing Albums/Playlists**: When you play an album or playlist, all tracks are fetched and added to the front of the queue, then the first track plays. There's no reliance on Spotify's "context" playback.

2. **Local Queue**: All upcoming tracks live in `localQueue` (array of track URIs). When a track ends, the next track is pulled from the queue.

3. **Play History**: A `playHistory` array tracks recently played songs (up to 100) to enable the "previous" button.

4. **Loop Mode**: When enabled, finished tracks are re-added to the end of the queue (unless already there). Skipping a track also re-adds it to the end.

### Queue Management
- Users can add tracks/albums/playlists to queue
- Click `+` adds to end, Shift+click adds to front ("play next")
- Queue items are draggable for reordering
- Queue persists across page reloads in localStorage

## State Management

### Global Variables
```javascript
accessToken       // Current OAuth access token
player            // Spotify.Player SDK instance  
playerReadyPromise // Resolves when player is ready
deviceId          // This device's Spotify Connect ID
currentState      // Last player state from SDK
localQueue        // Array of track URIs to play next
playHistory       // Array of recently played track URIs
currentTrackUri   // Currently playing track
loopEnabled       // Loop mode toggle
```

### localStorage Keys
Non-auth (shared across client IDs):
- `volume` - Volume level 0-100
- `last_view` - Last navigation view
- `last_search` - Cached search results
- `local_queue` - JSON array of track URIs
- `play_state` - Last playback position for resume
- `loop_enabled` - Loop mode toggle
- `column_count` - UI column count preference

Auth (per client ID, prefixed with `auth_<client_id>_`):
- `access_token`
- `refresh_token`
- `token_expiry`
- `code_verifier`

## Navigation

Browser history integration:
- Each view pushes state via `history.pushState()`
- `popstate` event triggers view restore
- Page title updates to reflect current view
- Last view restored on page load

Routes: `liked`, `albums`, `playlists`, `topArtists`, `topTracks`, `explore`, `playlist`, `album`, `artist`, `queue`, `search`

## Views

### Explore
The main discovery view with three sections:
1. **Your Mixes** - Release Radar, Discover Weekly, Daily Mix 1-6 (found via search)
2. **Made For You** - Playlists from Spotify's "Made For You" category
3. **Featured Playlists** - Spotify's editorial playlists

Sections load progressively as data arrives.

### Queue
Shows:
- **Now Playing** - Current track
- **Queue** - Upcoming tracks (draggable, removable)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Search |
| `d` | DJ |
| `p` | Playlists |
| `s` | Saved Albums |
| `l` | Liked Songs |
| `a` | Top Artists |
| `t` | Top Tracks |
| `e` | Explore |
| `q` | Queue |
| `c` | Lyrics |
| `Space` | Play/Pause |
| `←/→` | Seek 10s |
| `?` | Help |

Modifier keys (Ctrl, Alt, Meta) disable shortcuts.

## Track Relinking

Spotify uses "track relinking" for regional availability - the same song may have different URIs in different regions. When searching for a track in a playlist:
1. Check `track.uri` 
2. If not found, check `track.linked_from.uri`

## Radio Feature

Uses Spotify's `/recommendations` endpoint:
- Tracks: seed from track ID
- Artists: seed from artist ID, queue top 5 tracks first
- Albums/Playlists: seed from first 5 track IDs

Adds recommended tracks to local queue and starts playback.

## Lyrics

Fetches lyrics from LRCLIB API (proxied through server.py). Supports:
- Synced lyrics with auto-scroll
- Plain lyrics fallback
- Click on lyric line to seek

## File Structure

```
SimpleSpot/
├── index.html      # HTML structure and CSS styles
├── app.js          # JavaScript application logic
├── server.py       # Simple Python HTTP server (serves index.html and app.js)
├── README.md       # User-facing documentation
├── ARCHITECTURE.md # This file
└── AGENTS.md       # AI agent instructions
```

## External Dependencies

- Spotify Web Playback SDK (`https://sdk.scdn.co/spotify-player.js`)
- Spotify Web API (`https://api.spotify.com/v1/`)
- Spotify Accounts API (`https://accounts.spotify.com/`)
- LRCLIB API (`https://lrclib.net/`) - for lyrics

No other external libraries - vanilla HTML/CSS/JavaScript only.
