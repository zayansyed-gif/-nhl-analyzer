"""Reusable versions of the NHL request logic in STATS.PY, players.py and search.py.

The original scripts are deliberately not imported: they run input() at import time.
Only real NHL responses are used. A small in-memory cache avoids repeat requests.
"""

from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import requests


NHL_URL = "https://api-web.nhle.com/v1"
SEARCH_URL = "https://search.d3.nhle.com/api/v1/search/player"
CACHE_SECONDS = 60
_cache = {}
_cache_lock = Lock()


class NHLAPIError(Exception):
    """An error that can safely be shown to a visitor."""

    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def get_json(url, params=None):
    """Fetch JSON with a timeout and understandable network errors."""
    key = (url, tuple(sorted((params or {}).items())))
    with _cache_lock:
        saved = _cache.get(key)
        if saved and monotonic() - saved[0] < CACHE_SECONDS:
            return saved[1]

    try:
        response = requests.get(url, params=params, timeout=(5, 15))
        if response.status_code == 404:
            raise NHLAPIError("The NHL could not find that player or resource.", 404)
        if response.status_code == 429:
            raise NHLAPIError("The NHL is receiving too many requests. Please try again in a minute.", 429)
        response.raise_for_status()
        data = response.json()
    except requests.Timeout as error:
        raise NHLAPIError("The NHL took too long to respond. Please try again.") from error
    except requests.RequestException as error:
        raise NHLAPIError("We couldn't reach the NHL data service. Check your connection and try again.") from error
    except ValueError as error:
        raise NHLAPIError("The NHL returned an unreadable response. Please try again shortly.") from error

    with _cache_lock:
        # Bound memory when many different player names have been searched.
        expired = [k for k, v in _cache.items() if monotonic() - v[0] >= CACHE_SECONDS]
        for old_key in expired:
            del _cache[old_key]
        if len(_cache) >= 256:
            _cache.pop(next(iter(_cache)))
        _cache[key] = (monotonic(), data)
    return data


def localized(value):
    """NHL names are sometimes strings and sometimes language dictionaries."""
    return value.get("default", "") if isinstance(value, dict) else (value or "")


def season_label(season_id):
    text = str(season_id)
    return text[:4] + "–" + text[-2:]


def get_standings():
    """Reuse STATS.PY's standings endpoint and the same team stat fields."""
    data = get_json(NHL_URL + "/standings/now")
    rows = data.get("standings") if isinstance(data, dict) else None
    if not isinstance(rows, list) or not rows:
        raise NHLAPIError("NHL standings aren't available right now. Please try again shortly.")

    season_id = rows[0].get("seasonId")
    if not isinstance(season_id, int):
        raise NHLAPIError("The NHL standings did not include a valid season.")
    teams = []
    required = ("wins", "losses", "points", "goalFor", "goalAgainst", "gamesPlayed", "otLosses")
    for row in rows:
        if any(not isinstance(row.get(key), (int, float)) for key in required):
            raise NHLAPIError("Some NHL team statistics are incomplete. Please try again shortly.")
        abbreviation = localized(row.get("teamAbbrev"))
        teams.append({
            "abbreviation": abbreviation,
            "name": localized(row.get("teamName")),
            "city": localized(row.get("placeName")),
            "nickname": localized(row.get("teamCommonName")),
            "logo": row.get("teamLogoDark") or row.get("teamLogo"),
            "conference": row.get("conferenceName", ""),
            "division": row.get("divisionName", ""),
            "rank": row.get("leagueSequence", len(teams) + 1),
            "divisionRank": row.get("divisionSequence"),
            "conferenceRank": row.get("conferenceSequence"),
            "wildcardRank": row.get("wildcardSequence"),
            "wins": row["wins"],
            "losses": row["losses"],
            "otLosses": row["otLosses"],
            "points": row["points"],
            "gamesPlayed": row["gamesPlayed"],
            "goalsFor": row["goalFor"],
            "goalsAgainst": row["goalAgainst"],
            "goalDifferential": row["goalFor"] - row["goalAgainst"],
            "pointPctg": row.get("pointPctg"),
            "streak": str(row.get("streakCode", "")) + str(row.get("streakCount", "")),
            "lastTen": "{}-{}-{}".format(row.get("l10Wins", "—"), row.get("l10Losses", "—"), row.get("l10OtLosses", "—")),
        })
    teams.sort(key=lambda team: team["rank"])
    return {
        "teams": teams,
        "season": {"id": season_id, "label": season_label(season_id)},
        "dataDate": rows[0].get("date"),
        "updatedAt": data.get("standingsDateTimeUtc"),
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "cacheSeconds": CACHE_SECONDS,
        "source": NHL_URL + "/standings/now",
    }


def compare_teams(first, second):
    first, second = first.strip().upper(), second.strip().upper()
    if not first or not second:
        raise NHLAPIError("Choose two teams to compare.", 400)
    if first == second:
        raise NHLAPIError("Choose two different teams to compare.", 400)
    standings = get_standings()
    by_abbreviation = {team["abbreviation"]: team for team in standings["teams"]}
    if first not in by_abbreviation or second not in by_abbreviation:
        raise NHLAPIError("One of those teams wasn't found in the current NHL standings.", 404)
    return {"first": by_abbreviation[first], "second": by_abbreviation[second], "season": standings["season"]}


def search_players(query):
    """Reuse search.py's name search; return IDs so visitors need not type them."""
    query = query.strip()
    if len(query) < 2:
        raise NHLAPIError("Enter at least two letters of a player's name.", 400)
    if len(query) > 80:
        raise NHLAPIError("Please enter a shorter player name (80 characters maximum).", 400)
    rows = get_json(SEARCH_URL, {"culture": "en-us", "limit": 100, "q": query})
    if not isinstance(rows, list):
        raise NHLAPIError("The NHL player search is temporarily unavailable. Please try again.")
    players = []
    for row in rows:
        try:
            player_id = int(row["playerId"])
        except (KeyError, ValueError, TypeError):
            continue
        players.append({
            "id": player_id,
            "name": row.get("name", "Unknown player"),
            "team": row.get("teamAbbrev") or row.get("lastTeamAbbrev") or "NHL",
            "position": row.get("positionCode", ""),
            "active": row.get("active", False),
        })
    players.sort(key=lambda player: (player["name"].casefold() != query.casefold(), not player["active"], player["name"]))
    return {"players": players[:12]}


def get_player(player_id, season=None):
    """Reuse players.py's landing endpoint and current regular-season selection.

    Prefer featuredStats' NHL season total (important for traded players). Fall
    back to NHL regular-season rows only; never use minor-league or playoff data.
    """
    if not 1 <= player_id <= 99999999:
        raise NHLAPIError("Please choose a player from the search results.", 400)
    season = season or get_standings()["season"]
    data = get_json(NHL_URL + "/player/" + str(player_id) + "/landing")
    if not isinstance(data, dict) or not data.get("playerId"):
        raise NHLAPIError("The NHL returned an incomplete player profile.")
    name = (localized(data.get("firstName")) + " " + localized(data.get("lastName"))).strip()
    stats = None
    featured = data.get("featuredStats") or {}
    if featured.get("season") == season["id"]:
        stats = (featured.get("regularSeason") or {}).get("subSeason")

    if not stats:
        rows = [row for row in data.get("seasonTotals", [])
                if row.get("season") == season["id"]
                and row.get("gameTypeId") == 2
                and row.get("leagueAbbrev") == "NHL"]
        # Some profiles include a combined TOT row as well as each team's row.
        total = next((row for row in rows if localized(row.get("teamAbbrev")) in ("TOT", "NHL")
                      or localized(row.get("teamName")) in ("Total", "Totals")), None)
        if total:
            stats = total
        elif rows:
            fields = ("goals", "assists", "points", "gamesPlayed")
            if all(all(isinstance(row.get(key), (int, float)) for key in fields) for row in rows):
                stats = {key: sum(row[key] for row in rows) for key in fields}

    fields = ("goals", "assists", "points", "gamesPlayed")
    available = bool(stats) and all(isinstance(stats.get(key), (int, float)) for key in fields)
    reason = None
    if data.get("position") == "G":
        available = False
        reason = "This comparison uses skater statistics. Please choose a forward or defenseman."
    elif not available:
        reason = "{} has no published NHL regular-season statistics for {} yet. Try another player.".format(name, season["label"])
    return {
        "id": data["playerId"], "name": name,
        "team": data.get("currentTeamAbbrev") or "NHL",
        "teamName": localized(data.get("fullTeamName")),
        "position": data.get("position", ""),
        "number": data.get("sweaterNumber"),
        "headshot": data.get("headshot"),
        "active": data.get("isActive", False),
        "season": season,
        "available": available,
        "unavailableReason": reason,
        "stats": {key: stats[key] for key in fields} if available else None,
    }


def compare_players(first_id, second_id):
    if first_id == second_id:
        raise NHLAPIError("Choose two different players to compare.", 400)
    season = get_standings()["season"]
    first = get_player(first_id, season)
    second = get_player(second_id, season)
    for player in (first, second):
        if not player["available"]:
            raise NHLAPIError(player["unavailableReason"], 422)
    return {"first": first, "second": second, "season": season}


def get_player_profile(player_id):
    """Add profile presentation data without changing the comparison contract."""
    player = get_player(player_id)
    data = get_json(NHL_URL + "/player/" + str(player_id) + "/landing")
    season_id = player["season"]["id"]
    featured = data.get("featuredStats") or {}
    details = ((featured.get("regularSeason") or {}).get("subSeason") or {}
               if featured.get("season") == season_id else {})
    # Extra metrics are not inferred from a different season or league.
    if not details:
        rows = [row for row in data.get("seasonTotals", [])
                if row.get("season") == season_id and row.get("gameTypeId") == 2
                and row.get("leagueAbbrev") == "NHL"]
        details = next((row for row in rows if localized(row.get("teamAbbrev")) in ("TOT", "NHL")), {})
        if not details and len(rows) == 1:
            details = rows[0]
    games = []
    for game in data.get("last5Games", []):
        # NHL game IDs begin with the season's start year.
        if game.get("gameTypeId") == 2 and str(game.get("gameId", ""))[:4] == str(season_id)[:4]:
            games.append({key: game.get(key) for key in
                          ("gameDate", "opponentAbbrev", "homeRoadFlag", "goals", "assists", "points", "plusMinus", "toi")})
    player.update({
        "teamLogo": data.get("teamLogo"),
        "birthDate": data.get("birthDate"),
        "birthplace": ", ".join(filter(None, [localized(data.get("birthCity")), data.get("birthCountry")])),
        "heightCm": data.get("heightInCentimeters"), "weightKg": data.get("weightInKilograms"),
        "shootsCatches": data.get("shootsCatches"), "draft": data.get("draftDetails"),
        "extraStats": {key: details.get(key) for key in ("plusMinus", "shots", "shootingPctg", "pim", "powerPlayPoints")},
        "recentGames": games,
        "awards": [{"name": localized(award.get("trophy")),
                    "seasons": [season_label(row["seasonId"]) for row in award.get("seasons", []) if row.get("seasonId")]}
                   for award in data.get("awards", [])],
        "career": (data.get("careerTotals") or {}).get("regularSeason"),
    })
    return player


def get_player_leaders():
    """Current-season point leaders; identities and every total come from NHL."""
    from concurrent.futures import ThreadPoolExecutor

    season = get_standings()["season"]
    data = get_json(NHL_URL + "/skater-stats-leaders/" + str(season["id"]) + "/2",
                    {"categories": "points", "limit": 6})
    rows = data.get("points") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise NHLAPIError("NHL scoring leaders aren't available right now.")
    ids = [row["id"] for row in rows if isinstance(row.get("id"), int)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        players = list(pool.map(lambda player_id: get_player(player_id, season), ids))
    return {"players": players, "season": season}
