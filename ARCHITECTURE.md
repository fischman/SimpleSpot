# SimpleSpot Architecture

## Overview

SimpleSpot is a minimal Spotify web client implemented as a **single HTML file** (~1700 lines). It uses Spotify's Web API and Web Playback SDK to provide playback control, library browsing, and queue management.

## Key Design Decisions

### Single-File Architecture
Everything is contained in `index.html`:
- HTML structure
- CSS styles (in `<style>` tag)
- JavaScript application logic (in `<script>` tag)

This enables easy deployment and portability - just serve the single file.

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

### Playback
- Uses Spotify Web Playback SDK for actual audio playback
- Creates a "device" that appears in Spotify Connect
- Supports play/pause, next/previous, seek, volume control

### Local Queue
Spotify's queue API is limited, so we maintain a **local queue** in localStorage:
- Users can add tracks/albums/playlists to queue
- Queue persists across page reloads
- When a track ends, plays next from local queue before falling back to Spotify's context

### Loop Mode
When enabled:
- Saves current queue and context state
- When playback exhausts, restores saved state and replays from beginning
- State persisted in localStorage

## State Management

### Global Variables
```javascript
accessToken       // Current OAuth access token
player            // Spotify.Player SDK instance
deviceId          // This device's Spotify Connect ID
currentState      // Last player state from SDK
localQueue        // Array of track URIs to play
loopEnabled       // Loop mode toggle
loopState         // Saved state for loop restore
```

### localStorage Keys
Non-auth (shared across client IDs):
- `volume` - Volume level 0-100
- `last_view` - Last navigation view
- `last_search` - Cached search results
- `local_queue` - JSON array of track URIs
- `play_state` - Last playback position for resume
- `loop_enabled` - Loop mode toggle
- `loop_state` - Saved loop restore state
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

Routes: `liked`, `albums`, `playlists`, `topArtists`, `topTracks`, `playlist`, `album`, `artist`, `queue`, `search`

## Track Relinking

Spotify uses "track relinking" for regional availability - the same song may have different URIs in different regions. When searching for a track in a playlist:
1. Check `track.uri` 
2. If not found, check `track.linked_from.uri`

This ensures queue position is correctly identified even with relinked tracks.

## Radio Feature

Uses Spotify's `/recommendations` endpoint (works with ncspot client ID):
- Tracks: seed from track ID
- Artists: seed from artist ID, queue top 5 tracks first
- Albums/Playlists: seed from first 5 track IDs

Adds recommended tracks to local queue and starts playback.

## File Structure

```
spotify-client/
├── index.html      # The entire application
├── server.py       # Simple Python HTTP server for development
├── README.md       # User-facing documentation
├── ARCHITECTURE.md # This file
└── AGENTS.md       # AI agent instructions
```

## External Dependencies

- Spotify Web Playback SDK (`https://sdk.scdn.co/spotify-player.js`)
- Spotify Web API (`https://api.spotify.com/v1/`)
- Spotify Accounts API (`https://accounts.spotify.com/`)

No other external libraries - vanilla HTML/CSS/JavaScript only.
