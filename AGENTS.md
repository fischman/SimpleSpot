# Agent Instructions for SimpleSpot

## Project Context

SimpleSpot is a simple web-based Spotify client. The application consists of two files:
- `index.html` - HTML structure and CSS styles (~230 lines)
- `app.js` - All JavaScript application logic (~2500 lines)

## Code Style Preferences

### General
- **Brevity over verbosity** - Keep code concise
- **No unnecessary abstractions** - Direct, simple code preferred
- **Vanilla JS only** - No frameworks, no build tools, no npm
- **Minimal files** - Keep everything in index.html + app.js

### JavaScript
- Use `async/await` over `.then()` chains
- Use template literals for HTML generation
- Use `const`/`let`, never `var`
- Keep functions focused and small
- Use descriptive variable names

### CSS
- Inline styles acceptable for one-off cases
- Use CSS classes for repeated patterns
- Dark theme (#121212 background, #1db954 Spotify green)
- Mobile-responsive considerations

### HTML
- Semantic where practical
- IDs for elements accessed by JS
- `onclick` handlers acceptable for simple actions

## Debugging Preferences

### Logging
- Add `console.log` for debugging, but clean up after
- For persistent diagnostics, use `console.warn` or `console.error`
- Include context in log messages (function name, key values)
- For critical paths (like auth), keep some logging permanently

### Token/Auth Issues
- Always log reason when forcing relogin
- Include stack trace for unexpected logouts
- Log token refresh attempts and failures

### Testing Auth
Use this to force token expiry for testing:
```javascript
localStorage.setItem('auth_1366988155e64d34b759879f2a575cdd_token_expiry', Date.now() + 1000);
localStorage.setItem('auth_d420a117a32841c2b3474932e49fb54b_token_expiry', Date.now() + 1000);
```

## Common Patterns

### Adding a New View
1. Create `async function loadXxx(fromHistory = false)`
2. Add `if (!fromHistory) navigate('xxx', { params });` at start
3. Call `setBreadcrumb([...])` 
4. Fetch data with `await api(...)`
5. Render to `document.getElementById('tracks')`
6. Add case to `handleNavigation()` switch
7. Add case to `restoreLastView()` if it should be restorable

### Adding a Button to List Items
List items use a consistent structure:
```html
<li class="track">
  <div class="track-num-col">
    <span class="track-num">N</span>
    <button class="queue-btn" onclick="...">+</button>
    <button class="radio-btn" onclick="...">📻</button>
  </div>
  <div class="track-art">...</div>
  <div class="track-info">...</div>
</li>
```

For queue items, add drag handle on right:
```html
<div class="drag-handle" title="Drag to reorder">≡</div>
```

### API Calls
Always use the `api()` wrapper - it handles:
- Token refresh before expiry
- 401 retry with refresh
- Error logging

### Shareable Links
Use `shareLink(type, id, text, onclick)` to create links that:
- Left-click: runs onclick handler
- Right-click: browser "Copy link" to open.spotify.com URL

### Adding to Queue
- `addToQueue(uri, toFront)` - single track
- `addAlbumToQueue(albumId, toFront)` - all album tracks
- `addPlaylistToQueue(playlistId, toFront)` - all playlist tracks
- `toFront=true` adds to beginning, `toFront=false` (default) adds to end
- Pass `event.shiftKey` to enable Shift+click for "play next"

## Playback Model

SimpleSpot uses a **queue-only model**:

1. **No Spotify contexts** - We don't use `context_uri` for playback. Playing an album/playlist fetches all tracks and adds them to `localQueue`.

2. **Loop behavior** - When enabled (`loopEnabled`), finished/skipped tracks are re-added to the END of the queue (unless already there).

3. **Previous track** - Uses `playHistory` array. Previous puts current track back at front of queue and plays from history.

4. **Next track** - Pulls from `localQueue`. If loop enabled, current track is added to end first.

## Known Issues & Gotchas

### Track Relinking
Spotify returns different track URIs for the same song in different regions. Always check both `track.uri` and `track.linked_from?.uri` when searching playlists.

### Emoji Colors
Emojis can't be styled with CSS `color`. Use Unicode symbols (like ↻) instead if color changes are needed.

### Cross-Origin Popups
Can't read URL from popup windows on different origins. The ncspot OAuth flow requires manual URL paste because of this.

### setActiveNav
When adding new buttons to the player bar, exclude them from `setActiveNav()`'s class clearing:
```javascript
document.querySelectorAll('.header button.active, .player button.active:not(#my-btn)')
```

### Token Refresh
Spotify may issue a new refresh token on each refresh. Always save `data.refresh_token` if present, or subsequent refreshes fail with `invalid_grant`.

### Player Recreation
On 404 errors (stale device) or auth errors, the player must be fully recreated (`player.disconnect(); player = null; initPlayer();`). Just reconnecting doesn't get a fresh token.

### escapeHtml
Always use `escapeHtml()` for user-provided strings. It handles null/undefined safely.

## Don't Do

- Don't create additional files beyond index.html and app.js
- Don't add npm/build dependencies
- Don't use localStorage directly for auth - use `getAuth()`/`setAuth()`
- Don't assume track.uri matches playlist entries (relinking!)
- Don't try to auto-detect popup redirects (cross-origin blocks it)
- **Don't hide the header or player bars** - new views/overlays should only occupy the middle content area
- **Coordinate server.py changes** - it serves index.html; changes may be needed for new features
- **No arbitrary sleeps** - Don't use `sleep` in shell commands or `setTimeout` in JS unless there's a specific event being waited for

## Git Commits

- Write clear, concise commit messages
- One logical change per commit
- Include context for non-obvious changes
- Always `git push` immediately after every `git commit`

## Development Server

The server is managed externally - do not attempt to start/stop it or check logs.
You cannot test this project directly; make changes and let the user verify.
