import requests

response = requests.get("https://api-web.nhle.com/v1/standings/now")

print(response.status_code)
data = response.json()

found1 = False
found2 = False

choice1 = input("Enter first team abbreviation: ").upper()
choice2 = input("Enter second team abbreviation: ").upper()

for team in data["standings"]:

    if team["teamAbbrev"]["default"] == choice1:
        found1 = True
        name1 = team["teamName"]["default"]
        wins1 = team["wins"]
        losses1 = team["losses"]
        points1 = team["points"]
        goals1 = team["goalFor"]
        against1 = team["goalAgainst"]
        difference1 = goals1 - against1

    if team["teamAbbrev"]["default"] == choice2:
        found2 = True
        name2 = team["teamName"]["default"]
        wins2 = team["wins"]
        losses2 = team["losses"]
        points2 = team["points"]
        goals2 = team["goalFor"]
        against2 = team["goalAgainst"]
        difference2 = goals2 - against2


if found1 == False:
    print("Invalid first team abbreviation")

if found2 == False:
    print("Invalid second team abbreviation")


if found1 and found2:

    print("\n", name1, "vs", name2)

    print("Wins:", wins1, "vs", wins2)
    print("Losses:", losses1, "vs", losses2)
    print("Points:", points1, "vs", points2)
    print("Goals For:", goals1, "vs", goals2)
    print("Goals Against:", against1, "vs", against2)
    print("Goal Differential:", difference1, "vs", difference2)

    if wins1 > wins2:
        print(name1, "has more wins")

    elif wins1 < wins2:
        print(name2, "has more wins")

    else:
        print("Both teams have the same number of wins")
        
