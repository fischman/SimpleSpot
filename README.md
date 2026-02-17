# SimpleSpot

A simple Spotify client with minimal CPU usage.

# Motivation

Spotify's Linux client and their webapp both consume over 30% of a CPU
core constantly during playback, even when hidden / not visible. This
is enough to trigger my laptop's fan and annoy me. This client exists
to allow background playback in under 2% of a CPU core.

# Usage Notes

There's a help dialog; get to it by typing `?` or clicking the `?` at
the top-right of the app.

Every top-level view has a shortcut key
shown in the view's button's alt title on hover, and also in the above
help dialog.

Each entity listed in the list/grid views outside queue
(albums/playlists/tracks/artists) has a '+' button; clicking it will
add the entity to the end of the queue. Shift-clicking '+' will add
the entity to the head of the queue (so it'll play next). Each entity
also has a radio button; clicking it will replace the queue with a
list of recommendations based on that entity.

Each track listed in the queue has a '-' button; clicking it will
remove the track from the queue.

The "loop" control to the right of the progress bar at the bottom of
the app causes tracks to be re-added to the end of the queue when they
end.

The CC control to the right of the loop control toggles display of
lyrics. If time-synced lyrics are available then display will be
time-synced, otherwise they will be static.

Every track/album/artist/playlist name should be "linkified"; clicking
it will navigate to that entity in the app, and right-clicking
interacts with the https://open.spotify.com version of the entity.

# Developer information
## Client IDs
Some features like radio/recommendations, DJ, and Explore require
having registered the spotify client before [they were deprecated](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api). This webapp supports two different client IDs:
- **SimpleSpot**: registered too late, so above features are unavailable, but login flow is simplest.
- **ncspot**: Alternative, requires either running locally using `./server.py` or a manual URL copy/paste due to `http://127.0.0.1` redirect URI restriction.

## Authentication
Uses OAuth 2.0 PKCE flow. Access & refresh tokens are stored in
localStorage, and are automatically refreshed as needed.

## Queue
Spotify's Web API's [queue support](https://developer.spotify.com/documentation/web-api/reference/get-queue) is missing tons of
functionality: fetch complete queue (not just first 20 entries), edit
the queue in situ, clear the queue, etc.  Instead of trying to
shoehorn into that, SimpleSpot ignores the Player's "user queue"
concept and instead manages its own queue.

## Dependencies

Relies on Spotify's [Web API](https://developer.spotify.com/documentation/web-api) and [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference), as well as
LRCLIB's [API](https://lrclib.net/docs).

## Development
Run `./server.py` and load the webapp at http://127.0.0.1:8000/

Symlink `.hook_pre-commit` to `.git/hooks/pre-commit` to automatically
check formatting and run (contrived, non-comprehensive tests).

Run `./biome/fix` to auto-format and `./test/run` to run the tests
without a `git commit`.

## Authorship / Licensing

Although I've reviewed all the code in the repo, much of it was
written by LLMs, so I make no claims of authorship/ownership. Do as
you like with this, other than asserting your own authorship over it.
