# SimpleSpot

A simple Spotify client with minimal CPU usage.

# Motivation

Spotify's Linux client and their webapp both consume over 30% of a CPU
core constantly during playback, even when hidden / not visible. This
is enough to trigger my laptop's fan and annoy me. This client exists
to allow background playback in under 2% of a CPU core.

# Dependencies

Relies on Spotify's [Web API](https://developer.spotify.com/documentation/web-api) and [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/reference), as well as
LRCLIB's [API](https://lrclib.net/docs).

# Authorship / Licensing

Although I've reviewed all the code in the repo, much of it was
written by LLMs, so I make no claims of authorship/ownership. Do as
you like with this, other than asserting your own authorship over it.
