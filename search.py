import requests

name = input("Enter player name: ").strip()

response = requests.get(
    "https://search.d3.nhle.com/api/v1/search/player",
    params={"culture": "en-us", "limit": 100, "q": name}
)

print(response.status_code)

if response.status_code == 200:
    data = response.json()
    found = False

    for player in data:
        if player["name"].lower() == name.lower():
            found = True

            print("Player:", player["name"])
            print("Player ID:", player["playerId"])
            print("Team:", player["teamAbbrev"])

            break

    if found == False:
        print("Player not found")

else:
    print("Could not search for players")