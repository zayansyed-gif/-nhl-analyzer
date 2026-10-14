import requests

name1 = input("Enter first player name: ").strip()
name2 = input("Enter second player name: ").strip()

search1 = requests.get(
    "https://search.d3.nhle.com/api/v1/search/player",
    params={"culture": "en-us", "limit": 100, "q": name1}
)

search2 = requests.get(
    "https://search.d3.nhle.com/api/v1/search/player",
    params={"culture": "en-us", "limit": 100, "q": name2}
)

id1 = None
id2 = None

if search1.status_code == 200:
    for player in search1.json():
        if player["name"].lower() == name1.lower():
            id1 = player["playerId"]
            break

if search2.status_code == 200:
    for player in search2.json():
        if player["name"].lower() == name2.lower():
            id2 = player["playerId"]
            break

if id1 is not None and id2 is not None:

    response1 = requests.get(
        "https://api-web.nhle.com/v1/player/" + str(id1) + "/landing"
    )

    response2 = requests.get(
        "https://api-web.nhle.com/v1/player/" + str(id2) + "/landing"
    )

    if response1.status_code == 200 and response2.status_code == 200:

        data1 = response1.json()
        data2 = response2.json()

        stats1 = None
        stats2 = None

        for season in data1["seasonTotals"]:
            if season["season"] == 20262027 and season["gameTypeId"] == 2:
                stats1 = season
                break

        for season in data2["seasonTotals"]:
            if season["season"] == 20262027 and season["gameTypeId"] == 2:
                stats2 = season
                break

        if stats1 is not None and stats2 is not None:

            goals1 = stats1["goals"]
            goals2 = stats2["goals"]

            assists1 = stats1["assists"]
            assists2 = stats2["assists"]

            points1 = stats1["points"]
            points2 = stats2["points"]

            games1 = stats1["gamesPlayed"]
            games2 = stats2["gamesPlayed"]

            print("\n", name1, "vs", name2)

            print("Goals:", goals1, "vs", goals2)
            print("Assists:", assists1, "vs", assists2)
            print("Points:", points1, "vs", points2)
            print("Games Played:", games1, "vs", games2)

            if points1 > points2:
                print(name1, "has more points")

            elif points2 > points1:
                print(name2, "has more points")

            else:
                print("Both players have the same number of points")

        else:
            print("Season statistics unavailable for one or both players")

    else:
        print("Could not retrieve player statistics")

else:
    print("One or both players were not found")