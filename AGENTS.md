# Agent Instructions for SimpleSpot

## Project Context

SimpleSpot is a minimal Spotify web client. The entire application is a **single `index.html` file** - this is intentional and must be maintained. Do not split into multiple files.

## Code Style Preferences

### General
- **Brevity over verbosity** - Keep code concise
- **No unnecessary abstractions** - Direct, simple code preferred
- **Vanilla JS only** - No frameworks, no build tools, no npm
- **Single file** - All HTML, CSS, and JS in index.html

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

### API Calls
Always use the `api()` wrapper - it handles:
- Token refresh before expiry
- 401 retry with refresh
- Error logging

### Shareable Links
Use `shareLink(type, id, text, onclick)` to create links that:
- Left-click: runs onclick handler
- Right-click: browser "Copy link" to open.spotify.com URL

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

## Don't Do

- Don't create separate files (manifest.json, sw.js, etc.)
- Don't add npm/build dependencies
- Don't use localStorage directly for auth - use `getAuth()`/`setAuth()`
- Don't assume track.uri matches playlist entries (relinking!)
- Don't try to auto-detect popup redirects (cross-origin blocks it)
- **Don't hide the header or player bars** - new views/overlays should only occupy the middle content area
- **Coordinate server.py changes** - it serves index.html plus proxies (e.g., /lyrics); changes may be needed for new features
- **No arbitrary sleeps** - Don't use `sleep` in shell commands or `setTimeout` in JS unless there's a specific event being waited for

## Git Commits

- Write clear, concise commit messages
- One logical change per commit
- Include context for non-obvious changes

## Development Server

To restart server.py after changes:
```bash
pkill -f "^python3 server.py$" 2>/dev/null || true; cd /home/exedev/spotify-client && python3 server.py &
```
Use the anchored regexp to avoid killing the shell running the command.
