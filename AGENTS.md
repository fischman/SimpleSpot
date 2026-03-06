# Agent Instructions for SimpleSpot

## Project Context

SimpleSpot is a simple web-based Spotify client. The application consists of two files:
- `index.html` - HTML structure and CSS styles
- `app.js` - All JavaScript application logic

Serving the webapp locally is done by `server.py`.

## Code Style Preferences

### General
- **Brevity over verbosity** - Keep code concise
- **No unnecessary abstractions** - Direct, simple code preferred
- **Vanilla JS only** - No frameworks, no build tools, no npm
- **Minimal files** - Keep everything in index.html + app.js

### JavaScript
- Comments that are English sentences must end with a period
- Use `async/await` over `.then()` chains
- Use template literals for HTML generation
- Use `const`/`let`, never `var`
- **Never use emdashes** (— or –) anywhere - code, comments, commit messages, etc. Use hyphens or reword.
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

## Common Patterns

### API Calls
Always use the `api()` wrapper - it handles caching, token refresh, retries, backoff, and logging.

### Shareable Links
Use `shareLink` to create links that:
- Left-click: runs onclick handler
- Right-click: browser "Copy link" to open.spotify.com URL

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

### Player Recreation
On some errors (stale device, auth), the player must be fully recreated (`player.disconnect(); player = null; initPlayer();`). Just reconnecting doesn't get a fresh token.

### escapeHtml
Always use `escapeHtml()` for user-provided strings. It handles null/undefined safely.

## Don't Do

- Don't create additional files beyond index.html and app.js
- Don't add npm/build dependencies
- Don't use localStorage directly for auth - use `getAuth()`/`setAuth()`
- Don't assume track.uri matches playlist entries (relinking!)
- Don't try to auto-detect popup redirects (cross-origin blocks it)
- **Don't hide the header or player bars** - new views/overlays should only occupy the middle content area
- **Coordinate server.py changes** - it serves index.html and app.js; changes may be needed for new features
- **No arbitrary sleeps** - Don't use `setTimeout` in JS unless there's a specific event being waited for

## Communication Style

- When presenting tabular data, render it to fixed-column-width ASCII for display instead of a markdown table.

## Git Commits

- Write clear, concise commit messages
- One logical change per commit
- Include context for non-obvious changes
- Always `git push` immediately after every `git commit`

## Subagents

When launching subagents for parallel work:
- Each subagent must work in its **own worktree and branch** - never on main.
- Subagents must **not edit files in ~/SimpleSpot** (the main worktree).
- Subagents must **not push** - only the orchestrating agent pushes after review.

## Development Server

The server is managed externally - do not attempt to start/stop it or check logs.
You cannot test this project directly (missing Spotify credentials); make changes and let the user verify.
