# PuckPulse — NHL Stats Analyzer

A responsive Flask dashboard implementing the Google Stitch **NHL Flask Stats Dashboard** design (project `16912075458843831873`). Includes current NHL standings, player search and profiles, team comparisons, player comparisons, and interactive Chart.js visualizations. NHL data is retrieved through public endpoints; no API key is required or embedded in the app.

The three Stitch reference screens are NHL Standings (`6223b66503eb43e2ab7ec34b9afa1161`), Player Search (`f6a4b468ec8547179787eacdc7a34650`), and Player Detail (`c37684f238e54ed98111ceee4e84ed89`). The implementation uses their charcoal surfaces, cyan controls, Manrope typography, dense tables, player stat tiles, and mobile navigation. The desktop sidebar extends the mobile designs while retaining the existing comparison and visualization pages. Sample statistics and generated player images from the design are replaced with NHL API data and official NHL images.

## Run locally

Open Terminal and run:

```bash
cd /Users/zayansyed/Desktop/NHL.py
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Visit **http://127.0.0.1:5001**. Keep Terminal open while using the website. Press `Control+C` to stop it.

Your existing `.venv` already has the dependencies installed. If setting up a fresh copy, first create an environment with `python3 -m venv .venv`, then follow the commands above. Python 3.9 or later is required.

If port 5001 is occupied, run `PORT=5002 python app.py` and visit http://127.0.0.1:5002 instead. This binds only to your computer and leaves Flask's debugger off.

## Files

```text
NHL.py/
├── STATS.PY                 Your original console script — unchanged
├── players.py               Your original console script — unchanged
├── search.py                Your original console script — unchanged
├── app.py                   Flask page, API routes, and error responses
├── nhl_api.py               Reusable NHL requests and stat extraction
├── requirements.txt         Flask and requests dependencies
├── README.md                This guide
├── templates/
│   ├── index.html           Dashboard, navigation, comparisons, and charts
│   └── _player_browser.html Player search and profile sections
├── static/
│   ├── css/style.css        Existing comparison and dashboard layout
│   ├── css/stitch.css       Stitch theme and responsive player screens
│   ├── js/app.js            Comparison, standings, exports, and charts
│   ├── js/stitch.js         Player browser, profiles, and Stitch controls
│   ├── fonts/               Local Manrope/Inter fonts and their licenses
│   ├── vendor/              Local Chart.js 4.5.1 and its MIT license
│   └── favicon.svg          IceIQ icon
└── tests/
    ├── test_app.py          Original backend regression tests
    └── test_stitch.py       Profile and scoring-leader regression tests
```

## Using the dashboard

- **Standings:** Switch between Division, Wildcard, and League views. Choose a division or conference, search teams, and expand the league table to every team. Atlantic is the initial division. Wildcard view shows teams outside their division's top three in official NHL wildcard order. Position markers describe current placement, not clinched playoff berths. Select a team to compare it. CSV exports include the complete current filter results. Desktop summaries, charts, and league insights use the same real standings response; mobile prioritizes the standings table.
- **Player search:** Browse six current-season NHL points leaders, search a name, and filter the returned matches by position. Selecting a player opens their NHL profile, season performance, recent regular-season game log, draft information, and career awards. Search results and leaders retrieve actual profiles; unavailable totals display an em dash and explanation. Recent submitted searches and up to 24 saved player IDs are kept only in this browser's local storage. Position filters apply to the returned results, not the entire NHL player directory.
- **Player profile:** Save a player locally or choose **Compare stats** to put them into the first comparison slot. The second slot remains available for name search. No cap hit or league percentile is invented where the NHL landing response does not provide one.
- **Team comparison:** Search by full team name or abbreviation, choose each result, and press **Compare teams**. Toronto and Edmonton are initial selections; their statistics are fetched from the NHL. The display includes wins, regulation losses, points, goals for, goals against, and goal differential. Overtime losses appear in each team's record.
- **Player comparison:** Type at least two letters of a name, choose a search result, and press **Compare players**. The search retrieves the NHL ID automatically. The initial McDavid–Matthews matchup also resolves names and retrieves statistics through the API. No player IDs or statistics are hardcoded. Goalies have a clear explanation because the requested goals/assists/points comparison is for skaters.
- **Visualizations:** Explore the entire league or your most recent successful team/player comparison. Hover or tap chart elements for values and use **Save chart** to download a PNG. Team and player comparison pages also contain charts.

Search selectors support arrow keys, Enter, and Escape. The navigation becomes a menu on small screens. Reduced-motion preferences are respected.

## How your existing code is reused

Your console scripts call `input()` at the top level. Importing them into Flask would block web requests and execute their console behavior. Their NHL request and stat-extraction logic is therefore adapted into reusable functions in `nhl_api.py`, leaving all three files byte-for-byte unchanged:

| Original | Reused logic |
| --- | --- |
| `STATS.PY` | `/v1/standings/now`; `teamAbbrev`, `teamName`, `wins`, `losses`, `points`, `goalFor`, `goalAgainst`; goal differential is goals for minus goals against. |
| `search.py` / `players.py` | NHL name-search endpoint with `culture=en-us`, `limit=100`, and `q`; selecting a result retrieves `playerId`. |
| `players.py` | `/v1/player/{id}/landing`; current-season NHL regular-season statistics, using `gameTypeId == 2`. |

The backend also adds request timeouts, friendly errors, a 60-second response cache, bounded cache memory, and validation. It derives the current season from NHL standings instead of fixing it at `20262027`. For traded players, the current-season featured NHL total takes priority; the fallback combines NHL regular-season team rows. It excludes minor leagues, playoffs, and past seasons. Unpublished statistics stay unavailable rather than becoming invented zeros.

Flask sends normalized JSON to JavaScript on the same origin. Browser requests go through Flask, so there is no dependence on the NHL allowing cross-origin browser requests. Chart.js and Manrope are served locally. NHL statistics and team/player images still require an internet connection. Refresh updates the current data views, but NHL responses may be reused within the documented 60-second cache window. The footer displays the NHL snapshot date; no automatic background polling is used.

### API routes

| Route | Purpose |
| --- | --- |
| `GET /api/standings` | Standings, season, and snapshot metadata |
| `GET /api/teams` | Current teams and season |
| `GET /api/compare/teams?first=TOR&second=EDM` | Team comparison |
| `GET /api/players/search?q=Connor%20McDavid` | Player name matches and NHL IDs |
| `GET /api/players/8478402` | Player profile, current-season stats, current-season recent games, draft, and career awards |
| `GET /api/players/leaders` | Six scoring leaders for the season returned by the NHL standings |
| `GET /api/compare/players?first=8478402&second=8479318` | Player comparison using IDs resolved by search |

Errors return JSON such as `{"error": "Choose two different teams to compare."}` with an appropriate HTTP status. A player with no published current-season statistics has `available: false` and an explanation; comparing that player returns HTTP 422.

## Verify the backend

```bash
python -m unittest discover -s tests -v
```

Tests cover missing and invalid selections, API outages, timeouts, rate limits, caching, missing statistics, goalies, regular-season filtering, traded-player totals, season-specific leaders, zero-valued stats, and exclusion of prior-season games and extra statistics. Their isolated test fixtures are never used by the website.

The Stitch integration was also checked in a browser with live NHL data: standings filters and searches, player profiles and saved players, keyboard team selection, both comparison flows and swapping, CSV/PNG downloads, charts, and all six views at 320, 768, 1024, and 1440 pixel widths. These checks produced no browser console errors or page-level horizontal overflow. The standings table intentionally scrolls horizontally on small screens.

## Remaining limitations

- Player comparisons retain the existing skater-only goals/assists/points contract. Goalie profiles explain this rather than showing skater zeroes.
- Recent game logs include only published regular-season games for the standings' season. Offseason or missing data can leave those sections empty.
- Saved players are local to one browser; there is no account or cross-device sync.
- No score feed, cap-hit data, or percentile rankings were added; the supplied Stitch screens do not provide a backend for those features.

The NHL endpoints are public services and can change. The dashboard reports failures visibly. IceIQ is an independent project; team marks and player images are supplied by the NHL.
