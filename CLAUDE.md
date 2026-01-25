# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Olympic Men's Ice Hockey Tournament Pick'em application. Players submit predictions via CSV before the tournament, and the app tracks their scores against actual results from ESPN APIs.

## Tech Stack (per PRD)

- **Frontend**: React (functional components, hooks)
- **Backend**: Netlify Functions
- **Database**: Fauna DB, Firebase Firestore, or Supabase
- **Deployment**: Netlify

## ESPN API Endpoints

Base URL: `https://site.api.espn.com/apis/site/v2/sports/hockey/olympics-mens-ice-hockey`

- `/scoreboard?dates=20260211-20260222` - Game schedule and status
- `/summary?event={EVENT_ID}` - Detailed game results
- `/teams` - Team info, logos, colors
- `/standings` - Tournament standings

## Key Service Modules

### services/espnApi.js
- `fetchSchedule(dateRange)` - Get games from scoreboard API
- `fetchGameSummary(eventId)` - Get completed game details
- `fetchTeams()` - Get team metadata
- `fetchStandings()` - Get tournament standings

### services/csvProcessor.js
- `parsePlayerPicksCSV(csvData)` - Parse player pick files
- `validatePicks(picks, gameSchedule, teams)` - Validate against ESPN data
- `transformPicksToDatabase(picks, playerId)` - Prepare for storage

### services/scoring.js
- `getResult(scoreA, scoreB)` - Returns 'win_a' | 'win_b' | 'tie'
- `compareResults(predictedResult, actualResult)` - Boolean comparison
- `calculatePlayerScore(playerPicks, gameResults, config)` - Score calculation
- `getRoundType(game)` - Returns 'groupStage' | 'knockoutRound' | 'medalRound'

## Scoring Rules

Points awarded for correct **result only** (win/loss/tie), not exact score:
- Group stage: 1 point
- Knockout round: 2 points
- Medal round: 3 points

Exact score bonuses are noted as future enhancement - code should be structured to add this easily.

## CSV Format for Player Picks

```csv
game_id,team_a,team_a_score,team_b,team_b_score
401845663,Canada,4,USA,3
```

- `game_id`: ESPN event ID
- Team names must match ESPN data
- Scores are non-negative integers
- Ties allowed (equal scores)
- Players can skip games (no penalty, just 0 points)

## Pick Visibility

Predictions remain **hidden** from other players until each game starts. After game start, all predictions for that game become visible.

## Data Polling

- Refresh game results every 5-10 minutes (configurable in config.json)
- Cache API responses to avoid rate limiting
- Fallback to cached/static data if ESPN API fails
