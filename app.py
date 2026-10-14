"""Flask routes for IceIQ. Start locally with: python app.py"""

import os

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

import nhl_api


app = Flask(__name__)
app.json.sort_keys = False


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/standings")
def standings():
    return jsonify(nhl_api.get_standings())


@app.get("/api/teams")
def teams():
    data = nhl_api.get_standings()
    return jsonify(teams=data["teams"], season=data["season"])


@app.get("/api/compare/teams")
def team_comparison():
    return jsonify(nhl_api.compare_teams(request.args.get("first", ""), request.args.get("second", "")))


@app.get("/api/players/search")
def player_search():
    return jsonify(nhl_api.search_players(request.args.get("q", "")))


@app.get("/api/players/<int:player_id>")
def player_detail(player_id):
    return jsonify(nhl_api.get_player_profile(player_id))


@app.get("/api/players/leaders")
def player_leaders():
    return jsonify(nhl_api.get_player_leaders())


@app.get("/api/compare/players")
def player_comparison():
    try:
        first = int(request.args.get("first", ""))
        second = int(request.args.get("second", ""))
    except ValueError:
        raise nhl_api.NHLAPIError("Search for and select two players before comparing.", 400)
    return jsonify(nhl_api.compare_players(first, second))


@app.errorhandler(nhl_api.NHLAPIError)
def nhl_error(error):
    return jsonify(error=str(error)), error.status


@app.errorhandler(HTTPException)
def http_error(error):
    if request.path.startswith("/api/"):
        return jsonify(error=error.description), error.code
    return error


@app.errorhandler(Exception)
def unexpected_error(error):
    app.logger.exception("Unexpected request failure")
    return jsonify(error="Something went wrong while loading the data. Please try again."), 500


@app.after_request
def response_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    # Port 5001 avoids macOS AirPlay's commonly occupied port 5000.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5001")), debug=False)
