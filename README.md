# Sinima

A free, open-source movie app that runs in the browser and installs on a phone like a normal app (PWA).

- **Free films**: thousands of public-domain classics from the [Internet Archive](https://archive.org/details/feature_films), free and legal to watch. You can search and browse by genre.
- **Services**: legal streaming services that work in Ethiopia, loaded from [`sources/ethiopia.json`](sources/ethiopia.json).
- **My sources**: add your own sources by hand. They're saved on your device, and you can back them up or move them with copy and paste.

## Source types you can add

| Type | What to paste | What happens |
| --- | --- | --- |
| Video | A direct link to a `.mp4`, `.webm` or `.m3u8` file | Plays in the app |
| Playlist | A link to an `.m3u` playlist | Lists every entry, each plays in the app |
| Catalog | A link to a Sinima catalog `.json` (see below) | Lists the movies with posters |
| Website | Any website | Opens the site, like a bookmark |

Some sites don't allow other apps to read their files. A playlist or catalog from those sites won't open, but the same link still works as a **Website** shortcut.

Only add content you have the right to watch.

### Catalog format

Put a file like this anywhere online (for example in a GitHub repository) and add its link as a **Catalog**:

```json
{
  "name": "My film club",
  "movies": [
    {
      "title": "Night of the Living Dead",
      "url": "https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4",
      "poster": "https://archive.org/services/img/night_of_the_living_dead",
      "year": 1968,
      "description": "Public-domain horror classic."
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

## Put it online (Netlify)

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
| `app.js` | All app logic (commented) |
| `sources/ethiopia.json` | The legal services list |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable and let it open offline |

## License

[MIT](LICENSE): free to use, change and share.
