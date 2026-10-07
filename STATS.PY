import requests
response = requests.get("https://api-web.nhle.com/v1/standings/now")

print(response.status_code)
data = response.json()
found  = False 
choice = input("Enter a team abbreviation: ").upper()
for team in data["standings"]:
    if team["teamAbbrev"]["default"] == choice:
        found = True
        goal_difference = team["goalFor"] - team["goalAgainst"]
        print(team["teamName"]["default"])
        print("wins :",(team["wins"]))
        print("losses :",(team["losses"]))
        print("points :",(team["points"]))   
        print("Goals for:",(team["goalFor"]))   
        print("Goals against:",(team["goalAgainst"]))   
        print("Goal differential:", goal_difference)
        break


if found == False:
    print("Invalid team abbreviation")

