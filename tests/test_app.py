"""Offline regression tests. Test fixtures never enter the running dashboard.

Run: python -m unittest discover -s tests -v
"""

import unittest
from unittest.mock import Mock, patch

import requests

import nhl_api
from app import app


SEASON = {"id": 20262027, "label": "2026–27"}


def profile(**changes):
    data = {"playerId": 1234567, "firstName": {"default": "Test"},
            "lastName": {"default": "Skater"}, "position": "C", "seasonTotals": []}
    data.update(changes)
    return data


def season_row(**changes):
    row = {"season": SEASON["id"], "gameTypeId": 2, "leagueAbbrev": "NHL",
           "goals": 2, "assists": 3, "points": 5, "gamesPlayed": 4}
    row.update(changes)
    return row


class NHLTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        nhl_api._cache.clear()

    def test_home_and_local_assets(self):
        for path in ("/", "/static/css/style.css", "/static/js/app.js", "/static/vendor/chart.umd.min.js"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_api_bad_inputs_have_useful_json_errors(self):
        cases = ["/api/players/search?q=x", "/api/compare/players?first=bad", "/api/compare/teams", "/api/compare/teams?first=TOR&second=TOR", "/api/compare/players?first=123&second=123"]
        for path in cases:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json["error"])

    def test_unknown_api_route_is_json(self):
        response = self.client.get("/api/unknown")
        self.assertEqual(response.status_code, 404)
        self.assertIn("error", response.json)

    @patch("nhl_api.get_json", return_value={"standings": []})
    def test_empty_standings_are_not_fake_zeroes(self, fetch):
        response = self.client.get("/api/standings")
        self.assertEqual(response.status_code, 503)
        self.assertIn("aren't available", response.json["error"])

    @patch("nhl_api.requests.get", side_effect=requests.Timeout)
    def test_timeout_becomes_helpful_error(self, fetch):
        response = self.client.get("/api/standings")
        self.assertEqual(response.status_code, 503)
        self.assertIn("too long", response.json["error"])

    @patch("nhl_api.requests.get", side_effect=requests.ConnectionError)
    def test_connection_failure_becomes_helpful_error(self, fetch):
        response = self.client.get("/api/standings")
        self.assertEqual(response.status_code, 503)
        self.assertIn("couldn't reach", response.json["error"])

    @patch("nhl_api.requests.get")
    def test_malformed_json(self, fetch):
        response = Mock(status_code=200)
        response.json.side_effect = ValueError("Not JSON")
        fetch.return_value = response
        with self.assertRaisesRegex(nhl_api.NHLAPIError, "unreadable"):
            nhl_api.get_json("https://example.test")

    @patch("nhl_api.requests.get")
    def test_rate_limit_is_reported(self, fetch):
        fetch.return_value = Mock(status_code=429)
        response = self.client.get("/api/standings")
        self.assertEqual(response.status_code, 429)
        self.assertIn("too many", response.json["error"])

    @patch("nhl_api.requests.get")
    def test_successful_requests_are_cached(self, fetch):
        fetch.return_value = Mock(status_code=200, json=Mock(return_value={"actual": "response"}))
        first = nhl_api.get_json("https://example.test")
        second = nhl_api.get_json("https://example.test")
        self.assertEqual(first, second)
        self.assertEqual(fetch.call_count, 1)

    @patch("nhl_api.get_json")
    def test_no_previous_season_or_playoff_stats(self, fetch):
        fetch.return_value = profile(seasonTotals=[season_row(season=20252026), season_row(gameTypeId=3)])
        player = nhl_api.get_player(1234567, SEASON)
        self.assertFalse(player["available"])
        self.assertIsNone(player["stats"])
        self.assertIn("2026–27", player["unavailableReason"])

    @patch("nhl_api.get_json")
    def test_minor_league_stats_are_excluded(self, fetch):
        fetch.return_value = profile(seasonTotals=[season_row(leagueAbbrev="AHL")])
        self.assertFalse(nhl_api.get_player(1234567, SEASON)["available"])

    @patch("nhl_api.get_json")
    def test_traded_player_uses_featured_season_total(self, fetch):
        totals = {"goals": 4, "assists": 6, "points": 10, "gamesPlayed": 8}
        fetch.return_value = profile(featuredStats={"season": SEASON["id"], "regularSeason": {"subSeason": totals}}, seasonTotals=[season_row(), season_row()])
        self.assertEqual(nhl_api.get_player(1234567, SEASON)["stats"], totals)

    @patch("nhl_api.get_json")
    def test_traded_player_fallback_sums_nhl_teams(self, fetch):
        fetch.return_value = profile(seasonTotals=[season_row(), season_row(), season_row(leagueAbbrev="AHL")])
        self.assertEqual(nhl_api.get_player(1234567, SEASON)["stats"]["points"], 10)

    @patch("nhl_api.get_json")
    def test_real_zero_stats_are_available(self, fetch):
        fetch.return_value = profile(seasonTotals=[season_row(goals=0, assists=0, points=0)])
        player = nhl_api.get_player(1234567, SEASON)
        self.assertTrue(player["available"])
        self.assertEqual(player["stats"]["points"], 0)

    @patch("nhl_api.get_json")
    def test_goalie_has_clear_explanation(self, fetch):
        fetch.return_value = profile(position="G")
        self.assertIn("forward or defenseman", nhl_api.get_player(1234567, SEASON)["unavailableReason"])

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_player")
    def test_missing_stats_make_comparison_unavailable(self, player, standings):
        player.return_value = {"available": False, "unavailableReason": "No current-season stats."}
        response = self.client.get("/api/compare/players?first=123&second=456")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json["error"], "No current-season stats.")

    @patch("nhl_api.get_json")
    def test_player_search_sorts_active_matches_and_returns_ids(self, fetch):
        fetch.return_value = [
            {"playerId": "1", "name": "Test Retired", "active": False},
            {"playerId": "2", "name": "Test Current", "active": True, "teamAbbrev": "TOR"},
        ]
        result = nhl_api.search_players("Test")
        self.assertEqual(result["players"][0]["id"], 2)
        self.assertEqual(result["players"][0]["team"], "TOR")


if __name__ == "__main__":
    unittest.main()
