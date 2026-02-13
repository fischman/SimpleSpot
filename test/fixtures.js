// Spotify API response fixtures for testing.
//
// These are hand-written approximations of Spotify Web API responses,
// not recordings of real API calls. They only include the fields that
// app.js actually uses (plus a few for structural realism).
//
// To update:
// - If app.js starts using a new field from an API response, add that
//   field to the relevant fixture here.
// - If you add a new view or API call, add a fixture for it and a
//   matching mockApiRoute() in the test that exercises it.
// - Refer to https://developer.spotify.com/documentation/web-api/reference
//   for the full response schemas.
//
// FIXTURES is globally available in the test environment.
var FIXTURES = {};

const _imgs = (id) => [
  { url: `https://i.scdn.co/image/${id}-lg`, width: 640, height: 640 },
  { url: `https://i.scdn.co/image/${id}-md`, width: 300, height: 300 },
  { url: `https://i.scdn.co/image/${id}-sm`, width: 64, height: 64 },
];

const _queenArtist = {
  id: "1dfeR4HaWDbWqFHLkxsg1d",
  name: "Queen",
  uri: "spotify:artist:1dfeR4HaWDbWqFHLkxsg1d",
  type: "artist",
};

const _albumNight = {
  id: "1GbtB4zTqAsyfZEsm1RZfx",
  name: "A Night at the Opera",
  uri: "spotify:album:1GbtB4zTqAsyfZEsm1RZfx",
  album_type: "album",
  release_date: "1975-11-21",
  total_tracks: 12,
  images: _imgs("nightopera"),
  artists: [_queenArtist],
  type: "album",
};
const _albumJazz = {
  id: "6wPXUmYJ9mOAmGpEMgaEx1",
  name: "Jazz",
  uri: "spotify:album:6wPXUmYJ9mOAmGpEMgaEx1",
  album_type: "album",
  release_date: "1978-11-10",
  total_tracks: 13,
  images: _imgs("jazz"),
  artists: [_queenArtist],
  type: "album",
};
const _albumDay = {
  id: "2Iy2dAlTBEVFRkYmGAavfK",
  name: "A Day at the Races",
  uri: "spotify:album:2Iy2dAlTBEVFRkYmGAavfK",
  album_type: "album",
  release_date: "1976-12-10",
  total_tracks: 10,
  images: _imgs("dayraces"),
  artists: [_queenArtist],
  type: "album",
};

FIXTURES.track = {
  id: "4u7EnebtmKWzUH433cf5Qv",
  uri: "spotify:track:4u7EnebtmKWzUH433cf5Qv",
  name: "Bohemian Rhapsody",
  artists: [_queenArtist],
  album: _albumNight,
  duration_ms: 354947,
  disc_number: 1,
  track_number: 11,
  explicit: false,
  popularity: 90,
  is_local: false,
  type: "track",
  external_urls: {
    spotify: "https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv",
  },
  external_ids: { isrc: "GBUM71029604" },
  preview_url: null,
};

FIXTURES.track2 = {
  id: "5T8EDUDqKcs6OSOwEsfqG7",
  uri: "spotify:track:5T8EDUDqKcs6OSOwEsfqG7",
  name: "Don't Stop Me Now",
  artists: [_queenArtist],
  album: _albumJazz,
  duration_ms: 211960,
  disc_number: 1,
  track_number: 12,
  explicit: false,
  popularity: 88,
  is_local: false,
  type: "track",
  external_urls: {
    spotify: "https://open.spotify.com/track/5T8EDUDqKcs6OSOwEsfqG7",
  },
  external_ids: { isrc: "GBUM71029612" },
  preview_url: null,
};

FIXTURES.track3 = {
  id: "5fVZC9GiM4e8vu99W0Xf6J",
  uri: "spotify:track:5fVZC9GiM4e8vu99W0Xf6J",
  name: "Somebody to Love",
  artists: [_queenArtist],
  album: _albumDay,
  duration_ms: 296733,
  disc_number: 1,
  track_number: 1,
  explicit: false,
  popularity: 85,
  is_local: false,
  type: "track",
  external_urls: {
    spotify: "https://open.spotify.com/track/5fVZC9GiM4e8vu99W0Xf6J",
  },
  external_ids: { isrc: "GBUM71029701" },
  preview_url: null,
};

FIXTURES.album = {
  ..._albumNight,
  label: "EMI",
  popularity: 82,
  copyrights: [{ text: "1975 Queen Productions Ltd.", type: "C" }],
  genres: [],
  tracks: {
    href: "https://api.spotify.com/v1/albums/1GbtB4zTqAsyfZEsm1RZfx/tracks?offset=0&limit=50",
    items: [
      {
        id: "2OBofMJMkRSEhtFRbFEH6z",
        uri: "spotify:track:2OBofMJMkRSEhtFRbFEH6z",
        name: "Death on Two Legs",
        artists: [_queenArtist],
        duration_ms: 224493,
        disc_number: 1,
        track_number: 1,
        type: "track",
      },
      {
        id: "57JVGBtBLCfHw2muk5416J",
        uri: "spotify:track:57JVGBtBLCfHw2muk5416J",
        name: "You're My Best Friend",
        artists: [_queenArtist],
        duration_ms: 170466,
        disc_number: 1,
        track_number: 4,
        type: "track",
      },
      {
        id: "4u7EnebtmKWzUH433cf5Qv",
        uri: "spotify:track:4u7EnebtmKWzUH433cf5Qv",
        name: "Bohemian Rhapsody",
        artists: [_queenArtist],
        duration_ms: 354947,
        disc_number: 1,
        track_number: 11,
        type: "track",
      },
    ],
    limit: 50,
    next: null,
    offset: 0,
    previous: null,
    total: 3,
  },
};

FIXTURES.artist = {
  ..._queenArtist,
  images: _imgs("queen"),
  followers: { href: null, total: 52384567 },
  genres: ["classic rock", "glam rock", "rock"],
  popularity: 89,
  external_urls: {
    spotify: "https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d",
  },
};

FIXTURES.artistAlbums = {
  href: "https://api.spotify.com/v1/artists/1dfeR4HaWDbWqFHLkxsg1d/albums?offset=0&limit=20",
  items: [_albumNight, _albumJazz, _albumDay],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
};

FIXTURES.artistTopTracks = {
  tracks: [FIXTURES.track, FIXTURES.track2, FIXTURES.track3],
};

FIXTURES.playlist = {
  id: "37i9dQZF1DXcBWIGoYBM5M",
  name: "Today's Top Hits",
  uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  description: "The biggest songs right now.",
  collaborative: false,
  public: true,
  type: "playlist",
  images: _imgs("tophits"),
  owner: {
    id: "spotify",
    display_name: "Spotify",
    uri: "spotify:user:spotify",
    type: "user",
  },
  snapshot_id: "abc123",
  tracks: {
    href: "https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M/tracks?offset=0&limit=100",
    items: [
      {
        added_at: "2024-01-15T12:00:00Z",
        added_by: { id: "spotify", uri: "spotify:user:spotify" },
        is_local: false,
        track: FIXTURES.track,
      },
      {
        added_at: "2024-01-14T12:00:00Z",
        added_by: { id: "spotify", uri: "spotify:user:spotify" },
        is_local: false,
        track: FIXTURES.track2,
      },
      {
        added_at: "2024-01-13T12:00:00Z",
        added_by: { id: "spotify", uri: "spotify:user:spotify" },
        is_local: false,
        track: FIXTURES.track3,
      },
    ],
    limit: 100,
    next: null,
    offset: 0,
    previous: null,
    total: 3,
  },
  external_urls: {
    spotify: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  },
  followers: { href: null, total: 34567890 },
};

FIXTURES.playlists = {
  href: "https://api.spotify.com/v1/me/playlists?offset=0&limit=20",
  items: [
    {
      id: "37i9dQZF1DXcBWIGoYBM5M",
      name: "Today's Top Hits",
      uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      description: "The biggest songs right now.",
      images: _imgs("tophits"),
      tracks: { total: 50 },
      owner: { id: "spotify", display_name: "Spotify" },
      public: true,
      collaborative: false,
      type: "playlist",
    },
    {
      id: "37i9dQZF1DX4JAvHpjipBk",
      name: "New Music Friday",
      uri: "spotify:playlist:37i9dQZF1DX4JAvHpjipBk",
      description: "New music from this week.",
      images: _imgs("nmf"),
      tracks: { total: 80 },
      owner: { id: "spotify", display_name: "Spotify" },
      public: true,
      collaborative: false,
      type: "playlist",
    },
    {
      id: "5Rrf7mqN8uus2AaQQQNdc1",
      name: "My Playlist #1",
      uri: "spotify:playlist:5Rrf7mqN8uus2AaQQQNdc1",
      description: "",
      images: _imgs("mypl1"),
      tracks: { total: 25 },
      owner: { id: "testuser", display_name: "Test User" },
      public: false,
      collaborative: false,
      type: "playlist",
    },
  ],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
};

const _searchTrack2 = {
  id: "3z8h0TU7ReDPLIbEnYhWZb",
  uri: "spotify:track:3z8h0TU7ReDPLIbEnYhWZb",
  name: "Bohemian Rhapsody - Remastered 2011",
  artists: [_queenArtist],
  album: _albumNight,
  duration_ms: 355000,
  type: "track",
};
const _searchArtist2 = {
  id: "2kip26Bze2jPPCmljSHPbw",
  name: "Queen Bee",
  uri: "spotify:artist:2kip26Bze2jPPCmljSHPbw",
  images: _imgs("queenbee"),
  followers: { href: null, total: 120000 },
  genres: ["j-rock"],
  popularity: 65,
  type: "artist",
};
const _searchAlbum2 = {
  id: "7HYL1pb2Eo8mFNHRloqSos",
  name: "Queen II",
  uri: "spotify:album:7HYL1pb2Eo8mFNHRloqSos",
  album_type: "album",
  release_date: "1974-03-08",
  total_tracks: 11,
  images: _imgs("queen2"),
  artists: [_queenArtist],
  type: "album",
};
const _searchPlaylist2 = {
  id: "2ZqR7KXKAB3VmdMHAJab3m",
  name: "Queen Greatest Hits",
  uri: "spotify:playlist:2ZqR7KXKAB3VmdMHAJab3m",
  description: "Best of Queen",
  images: _imgs("qgh"),
  tracks: { total: 30 },
  owner: { id: "spotify", display_name: "Spotify" },
  type: "playlist",
};

FIXTURES.searchResults = {
  tracks: {
    href: "https://api.spotify.com/v1/search?query=queen&type=track&offset=0&limit=20",
    items: [FIXTURES.track, _searchTrack2],
    limit: 20,
    next: null,
    offset: 0,
    previous: null,
    total: 2,
  },
  artists: {
    href: "https://api.spotify.com/v1/search?query=queen&type=artist&offset=0&limit=20",
    items: [FIXTURES.artist, _searchArtist2],
    limit: 20,
    next: null,
    offset: 0,
    previous: null,
    total: 2,
  },
  albums: {
    href: "https://api.spotify.com/v1/search?query=queen&type=album&offset=0&limit=20",
    items: [_albumNight, _searchAlbum2],
    limit: 20,
    next: null,
    offset: 0,
    previous: null,
    total: 2,
  },
  playlists: {
    href: "https://api.spotify.com/v1/search?query=queen&type=playlist&offset=0&limit=20",
    items: [
      {
        id: "37i9dQZEVXbMDoHDwVN2tF",
        name: "This Is Queen",
        uri: "spotify:playlist:37i9dQZEVXbMDoHDwVN2tF",
        description: "Essential Queen.",
        images: _imgs("thisqueen"),
        tracks: { total: 60 },
        owner: { id: "spotify", display_name: "Spotify" },
        type: "playlist",
      },
      _searchPlaylist2,
    ],
    limit: 20,
    next: null,
    offset: 0,
    previous: null,
    total: 2,
  },
};

FIXTURES.savedAlbums = {
  href: "https://api.spotify.com/v1/me/albums?offset=0&limit=20",
  items: [
    { added_at: "2024-01-10T10:00:00Z", album: FIXTURES.album },
    {
      added_at: "2024-01-05T10:00:00Z",
      album: {
        ..._albumJazz,
        label: "EMI",
        popularity: 78,
        genres: [],
        copyrights: [{ text: "1978 Queen Productions Ltd.", type: "C" }],
        tracks: {
          href: "https://api.spotify.com/v1/albums/6wPXUmYJ9mOAmGpEMgaEx1/tracks?offset=0&limit=50",
          items: [
            {
              id: "5T8EDUDqKcs6OSOwEsfqG7",
              uri: "spotify:track:5T8EDUDqKcs6OSOwEsfqG7",
              name: "Don't Stop Me Now",
              artists: [_queenArtist],
              duration_ms: 211960,
              disc_number: 1,
              track_number: 12,
              type: "track",
            },
          ],
          limit: 50,
          next: null,
          offset: 0,
          previous: null,
          total: 1,
        },
      },
    },
  ],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 2,
};

FIXTURES.likedSongs = {
  href: "https://api.spotify.com/v1/me/tracks?offset=0&limit=20",
  items: [
    { added_at: "2024-01-15T08:00:00Z", track: FIXTURES.track },
    { added_at: "2024-01-14T08:00:00Z", track: FIXTURES.track2 },
    { added_at: "2024-01-13T08:00:00Z", track: FIXTURES.track3 },
  ],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
};

FIXTURES.topArtists = {
  href: "https://api.spotify.com/v1/me/top/artists?time_range=medium_term&offset=0&limit=20",
  items: [
    FIXTURES.artist,
    {
      id: "0oSGxfWSnnOXhD2fKuz2Gy",
      name: "David Bowie",
      uri: "spotify:artist:0oSGxfWSnnOXhD2fKuz2Gy",
      images: _imgs("bowie"),
      followers: { href: null, total: 12345678 },
      genres: ["art rock", "glam rock", "classic rock"],
      popularity: 82,
      type: "artist",
    },
    {
      id: "22bE4uQ6baNwSHPVcDxLCe",
      name: "The Rolling Stones",
      uri: "spotify:artist:22bE4uQ6baNwSHPVcDxLCe",
      images: _imgs("stones"),
      followers: { href: null, total: 23456789 },
      genres: ["classic rock", "rock"],
      popularity: 84,
      type: "artist",
    },
  ],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
};

FIXTURES.topTracks = {
  href: "https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&offset=0&limit=20",
  items: [FIXTURES.track, FIXTURES.track2, FIXTURES.track3],
  limit: 20,
  next: null,
  offset: 0,
  previous: null,
  total: 3,
};

FIXTURES.devices = {
  devices: [
    {
      id: "device1abc",
      is_active: true,
      is_private_session: false,
      is_restricted: false,
      name: "My Computer",
      type: "Computer",
      volume_percent: 75,
      supports_volume: true,
    },
    {
      id: "device2def",
      is_active: false,
      is_private_session: false,
      is_restricted: false,
      name: "Living Room Speaker",
      type: "Speaker",
      volume_percent: 50,
      supports_volume: true,
    },
  ],
};

FIXTURES.recommendations = {
  tracks: [
    FIXTURES.track,
    FIXTURES.track2,
    FIXTURES.track3,
    {
      id: "7hQJA50XrCWABAu5v6QZ4i",
      uri: "spotify:track:7hQJA50XrCWABAu5v6QZ4i",
      name: "Under Pressure",
      artists: [
        _queenArtist,
        {
          id: "0oSGxfWSnnOXhD2fKuz2Gy",
          name: "David Bowie",
          uri: "spotify:artist:0oSGxfWSnnOXhD2fKuz2Gy",
          type: "artist",
        },
      ],
      album: {
        id: "3Ud0Nh7Sgm4MJGD7aBqVEz",
        name: "Hot Space",
        uri: "spotify:album:3Ud0Nh7Sgm4MJGD7aBqVEz",
        album_type: "album",
        release_date: "1982-05-21",
        total_tracks: 11,
        images: _imgs("hotspace"),
        artists: [_queenArtist],
        type: "album",
      },
      duration_ms: 248067,
      type: "track",
    },
  ],
  seeds: [
    {
      afterFilteringSize: 100,
      afterRelinkingSize: 100,
      href: "https://api.spotify.com/v1/artists/1dfeR4HaWDbWqFHLkxsg1d",
      id: "1dfeR4HaWDbWqFHLkxsg1d",
      initialPoolSize: 500,
      type: "ARTIST",
    },
  ],
};
