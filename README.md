# Sinima

A free, open-source movie and series app that runs in the browser and installs on a phone like a normal app (PWA). No ads, no login.

**Live app:** <https://josecoolboy92.github.io/Sinima/>

## What it does

- **Home**: scrolling rows like a streaming app: Continue watching, My list, Popular free films, Classic TV series, Cartoons, genre rows, and a row for each of your sources. "See all" opens the full list with search.
- **Details page** for every title: poster, description, length, Play / Resume, **+ My list**, Download (for free public-domain titles), seasons and episodes, and **More like this**.
- **Continue watching**: remembers where you stopped each film or episode, and picks up from there.
- **Player**: next and previous episode, plays the next episode automatically (you can turn this off in More), playback speed, and **subtitles** (the film's own subtitle files, or an `.srt`/`.vtt` file from your phone).
- **Search**: one search across the free films, series and all your sources.
- **My list**: save titles to watch later.
- **Sources**: add your own collections, channels, playlists and websites (see below). Each gets its own screen and a Home row.
- **More**: legal streaming services in Ethiopia ([`sources/ethiopia.json`](sources/ethiopia.json)), settings, and backup and restore of your sources and My list.
- **Websites inside the app**: a website you add opens edge to edge (the app's header and tabs hide), with Back, Reload, **Full screen** and Open-in-browser buttons. Videos inside the site can go full screen too. Pop-ups are blocked by default (switch in More), and the site can't take over the app. Your websites also get a row on Home.
- **Full screen** for the app's own player too. The phone turns sideways automatically (switch in More).
- The phone's back button works between screens, and closes the player first.

The built-in films and series are public-domain titles from the [Internet Archive](https://archive.org), free and legal to watch.

## Source types you can add

Paste a link and choose **Detect automatically**, or pick the type yourself.

| Type | Example link | What you get in the app |
| --- | --- | --- |
| Internet Archive | `https://archive.org/details/classic_tv` | Poster grid with search. Items with several videos open as a series with episodes |
| PeerTube | `https://peertube.tv/c/channelname` (also `/a/…` accounts, `/w/p/…` playlists, or a whole PeerTube site) | Poster grid; a playlist shows as one series |
| YouTube | A playlist link with `list=`, a video link, or `youtube.com/channel/UC…` | YouTube's official player with its own episode list |
| Catalog | A Sinima `.json` file (see below) | Movies and series with posters |
| Playlist | An `.m3u` file | Entries with the same `group-title` become a series |
| Video | A `.mp4`, `.webm` or `.m3u8` file | Plays in the app |
| Website | Any website | The site shown edge to edge inside the app, with full screen and an "Open in browser" button |

Notes:

- YouTube doesn't let apps list a playlist's videos without a paid developer key, so YouTube sources use YouTube's own player. Channel links with `@name` can't be used; open the channel's Videos tab, tap **Play all**, and add that link.
- Some websites don't allow being shown inside other apps. Their page stays blank, so use **Open in browser**.
- Some sites don't allow other apps to read their files, so their playlists or catalogs won't open.

Only add content you have the right to watch.

### Catalog format

Put a file like this anywhere online (for example in a GitHub repository) and add its link:

```json
{
  "name": "My film club",
  "movies": [
    {
      "title": "Night of the Living Dead",
      "url": "https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4",
      "poster": "https://archive.org/services/img/night_of_the_living_dead",
      "year": 1968,
      "description": "Public-domain horror classic.",
      "subtitles": [ { "label": "English", "url": "https://example.com/notld.en.srt" } ]
    }
  ],
  "series": [
    {
      "title": "My series",
      "poster": "https://example.com/poster.jpg",
      "episodes": [
        { "title": "Episode 1", "url": "https://example.com/ep1.mp4" },
        { "title": "Episode 2", "url": "https://example.com/ep2.mp4" }
      ]
    }
  ]
}
```

## Run it on your computer

There's no build step. Serve the folder with any static web server, for example:

```bash
npx serve .
```

Then open the address it prints. (Opening `index.html` directly from disk won't work, because browsers block some features for local files.)

## It's online

The app is published free with GitHub Pages at <https://josecoolboy92.github.io/Sinima/>, from the `gh-pages` branch. To update the site, push the same commit to `gh-pages`.

## Put it online with Netlify instead

1. On [Netlify](https://app.netlify.com), choose **Add new site → Import an existing project**.
2. Pick this GitHub repository. Leave the build command empty. The publish directory is `.` (already set in `netlify.toml`).
3. Deploy. Every push to `main` updates the site.

## Make an Android app (PWABuilder)

Once it's online, paste the Netlify address into [PWABuilder](https://www.pwabuilder.com) and choose **Android** to get an installable package.

## Update the Ethiopia services list

Edit [`sources/ethiopia.json`](sources/ethiopia.json). Each service has a `name`, `url`, `kind` (`free`, `paid` or `rent`), `language` and `description`. Please update `lastChecked` when you check the list.

## Project files

| File | What it does |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | Colors and layout |
| `app.js` | All app logic (commented). Each source type is an "adapter" in `ADAPTERS`; Home rows are in `HOME_ROWS` |
| `sources/ethiopia.json` | The legal services list |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable and let it open offline |

## License

[MIT](LICENSE): free to use, change and share.
