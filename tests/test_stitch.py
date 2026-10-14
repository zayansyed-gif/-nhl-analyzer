"""Regression checks for the Stitch presentation's new NHL data contracts."""
import unittest
from unittest.mock import patch

import nhl_api
from app import app


SEASON = {"id": 20262027, "label": "2026–27"}


def player_payload(**changes):
    data = {"playerId": 123, "firstName": {"default": "Test"}, "lastName": {"default": "Player"},
            "position": "C", "featuredStats": {"season": SEASON["id"], "regularSeason": {"subSeason": {
                "gamesPlayed": 2, "goals": 0, "assists": 3, "points": 3, "shots": 8, "plusMinus": -2}}}}
    data.update(changes)
    return data


class StitchTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_local_design_assets_and_template(self):
        home = self.client.get("/")
        self.assertIn(b"Player Search", home.data)
        self.assertIn(b"stitch.js", home.data)
        for path in ("/static/css/stitch.css", "/static/js/stitch.js", "/static/fonts/manrope-variable.ttf"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_json")
    def test_profile_keeps_zero_stats_and_current_regular_season_games(self, fetch, standings):
        fetch.return_value = player_payload(last5Games=[
            {"gameId": 2026020001, "gameTypeId": 2, "gameDate": "2026-10-01", "goals": 0},
            {"gameId": 2025030001, "gameTypeId": 3, "gameDate": "2026-06-01", "goals": 3},
            {"gameId": 2025020001, "gameTypeId": 2, "gameDate": "2025-10-01", "goals": 4},
        ])
        response = self.client.get("/api/players/123")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["stats"]["goals"], 0)
        self.assertEqual(response.json["extraStats"]["plusMinus"], -2)
        self.assertEqual(len(response.json["recentGames"]), 1)
        self.assertEqual(response.json["recentGames"][0]["gameDate"], "2026-10-01")

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_json")
    def test_profile_never_uses_old_featured_statistics(self, fetch, standings):
        data = player_payload()
        data["featuredStats"]["season"] = 20252026
        fetch.return_value = data
        profile = nhl_api.get_player_profile(123)
        self.assertFalse(profile["available"])
        self.assertIsNone(profile["stats"])
        self.assertTrue(all(value is None for value in profile["extraStats"].values()))
        self.assertEqual(profile["recentGames"], [])

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_player", return_value={"id": 123, "available": True})
    @patch("nhl_api.get_json", return_value={"points": [{"id": 123}]})
    def test_leaders_use_explicit_current_regular_season(self, fetch, player, standings):
        response = self.client.get("/api/players/leaders")
        self.assertEqual(response.status_code, 200)
        fetch.assert_called_once_with(nhl_api.NHL_URL + "/skater-stats-leaders/20262027/2", {"categories": "points", "limit": 6})
        player.assert_called_once_with(123, SEASON)
        self.assertEqual(response.json["players"][0]["id"], 123)

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_json", return_value={"points": []})
    def test_empty_leaders_do_not_become_sample_players(self, fetch, standings):
        self.assertEqual(self.client.get("/api/players/leaders").json["players"], [])

    @patch("nhl_api.get_standings", return_value={"season": SEASON})
    @patch("nhl_api.get_json", return_value={})
    def test_missing_leaders_returns_useful_failure(self, fetch, standings):
        response = self.client.get("/api/players/leaders")
        self.assertEqual(response.status_code, 503)
        self.assertIn("aren't available", response.json["error"])


if __name__ == "__main__":
    unittest.main()
