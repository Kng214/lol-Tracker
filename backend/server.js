const express = require('express') 
const cors  = require('cors') 
const axios = require('axios');
const pool = require('./db.js'); 

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/frontend'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/frontend/index.html');
});

// Search player and store in database
app.get('/api/search/:gameName/:tagLine', async (req, res) => {
  try {
    const { gameName, tagLine } = req.params;
    
    const accountResponse = await axios.get(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`,
      { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY } }
    );
    
    const { puuid, gameName: riotGameName, tagLine: riotTagLine } = accountResponse.data;
    
    const summonerResponse = await axios.get(
      `https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY } }
    );
    
    const { summonerLevel, profileIconId } = summonerResponse.data;
    
    const playerResult = await pool.query(
      `INSERT INTO players (puuid, game_name, tag_line, summoner_level, profile_icon_id) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (puuid) DO UPDATE SET
         game_name = $2, tag_line = $3, summoner_level = $4, profile_icon_id = $5, last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [puuid, riotGameName, riotTagLine, summonerLevel, profileIconId]
    );
    
    res.json({
      message: 'Player found and stored!',
      player: playerResult.rows[0],
      puuid: puuid
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get match history from Riot API
app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    
    const matchIdsResponse = await axios.get(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`,
      {
        headers: {
          'X-Riot-Token': process.env.RIOT_API_KEY
        },
        params: {
          count: 20
        }
      }
    );
    
    res.json(matchIdsResponse.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get detailed match data from Riot API
app.get('/api/match/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    
    const response = await axios.get(
      `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      {
        headers: {
          'X-Riot-Token': process.env.RIOT_API_KEY
        }
      }
    );
    
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch and store matches from Riot API
app.post('/api/players/:puuid/fetch-matches', async (req, res) => {
  try {
    const { puuid } = req.params;
    
    // 1. Get match IDs from Riot API
    const matchIdsResponse = await axios.get(
      `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`,
      {
        headers: { 'X-Riot-Token': process.env.RIOT_API_KEY },
        params: { count: 20 }
      }
    );
    
    const matchIds = matchIdsResponse.data;
    let processedCount = 0;
    
    // 2. Process each match
    for (const matchId of matchIds) {
      // Check if match already exists in database
      const existingMatch = await pool.query(
        'SELECT * FROM matches WHERE match_id = $1 AND puuid = $2',
        [matchId, puuid]
      );
      
      if (existingMatch.rows.length === 0) {
        // 3. Get detailed match data from Riot API
        const matchResponse = await axios.get(
          `https://americas.api.riotgames.com/lol/match/v5/matches/${matchId}`,
          { headers: { 'X-Riot-Token': process.env.RIOT_API_KEY } }
        );
        
        const matchData = matchResponse.data;
        
        const participant = matchData.info.participants.find(p => p.puuid === puuid);
        
        if (participant) {
          const totalMinionsKilled = participant.totalMinionsKilled || 0;
          const neutralMinionsKilled = participant.neutralMinionsKilled || 0;
          
          const challenges = participant.challenges || {};
          const jungleCsBefore10Min = challenges.jungleCsBefore10Min || 0;
          const epicMonsterKills = participant.objectivesEpicMonsterKills || 0;
          const monsterKills = participant.objectivesMonsterKills || 0;
          
          const totalCS = totalMinionsKilled + neutralMinionsKilled + epicMonsterKills;
          
          const kda = parseFloat(((participant.kills + participant.assists) / Math.max(participant.deaths, 1)).toFixed(2));
          
          // 5. Store match in database using 'cs' column
          await pool.query(
            `INSERT INTO matches 
            (match_id, puuid, champion, kills, deaths, assists, kda, win, 
            game_mode, game_duration, items, cs, gold, damage, game_start) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              matchId, puuid, participant.championName, 
              participant.kills, participant.deaths, participant.assists,
              kda,
              participant.win,
              matchData.info.gameMode, matchData.info.gameDuration,
              JSON.stringify({
                item0: participant.item0,
                item1: participant.item1,
                item2: participant.item2,
                item3: participant.item3,
                item4: participant.item4,
                item5: participant.item5,
                item6: participant.item6
              }),
              totalCS, 
              participant.goldEarned, participant.totalDamageDealtToChampions,
              new Date(matchData.info.gameStartTimestamp)
            ]
          );
          processedCount++;
        }
      }
    }
    
    res.json({ message: `Processed ${processedCount} new matches` });
    
  } catch (err) {
    console.error('Error fetching matches:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//Get all matches
app.get('/players/:puuid/matches', async(req, res) => {
    try {
        const { puuid } = req.params;
        const result = await pool.query(`SELECT match_id, champion, kills, assists, deaths, kda, win, 
            game_mode, game_duration, items, cs, gold, damage, game_start
            FROM matches 
            WHERE puuid = $1 
            ORDER BY game_start DESC`,
            [puuid]
        );

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message});
    }
});

//Get specific match by ID
app.get('/matches/:matchId', async (req, res) => {
    try {
        const { matchId } = req.params;
        const result = await pool.query(
            `SELECT m.*, p.game_name, p.tag_line 
            FROM matches m
            JOIN players p ON m.puuid = p.puuid
            WHERE m.match_id = $1`,
      [matchId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Match not found' });
        }
    
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})

//add new player
app.post('/players', async(req, res) => {
    try {
        const { puuid, game_name, tag_line, summoner_level, profile_icon_id } = req.body;
        const result = await pool.query(
            `INSERT INTO players (puuid, game_name, tag_line, summoner_level, profile_icon_id) 
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [puuid, game_name, tag_line, summoner_level, profile_icon_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({error: err.message});
    }
});

//add new match - FIXED to use 'cs' instead of creep columns
app.post('/matches', async (req, res) => {
    try {
        const {
            match_id, puuid, champion, kills, deaths, assists, kda, win, 
            game_mode, game_duration, items, cs, gold, damage, game_start 
        } = req.body;
        
        const result = await pool.query(
            `INSERT INTO matches 
            (match_id, puuid, champion, kills, deaths, assists, kda, win, 
            game_mode, game_duration, items, cs, gold, damage, game_start) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
            RETURNING *`,
            [match_id, puuid, champion, kills, deaths, assists, kda, win, 
            game_mode, game_duration, items, cs, gold, damage, game_start]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//get player stats
app.get('/players/:puuid/stats', async (req, res) => {
    try {
        const { puuid } = req.params;

        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_games,
                COUNT(CASE WHEN win = true THEN 1 END) as wins,
                COUNT(CASE WHEN win = false THEN 1 END) as losses,
                ROUND(
                    COUNT(CASE WHEN win = true THEN 1 END) * 100.0 / COUNT(*), 2
                ) as win_rate,
                 ROUND(AVG(kda), 2) as avg_kda,
                MODE() WITHIN GROUP (ORDER BY champion) as favorite_champion,
                SUM(kills) as total_kills,
                SUM(deaths) as total_deaths, 
                SUM(assists) as total_assists,
                ROUND(AVG(cs), 2) as avg_cs,
                ROUND(AVG(gold), 2) as avg_gold,
                ROUND(AVG(damage), 2) as avg_damage
            FROM matches 
            WHERE puuid = $1`,
            [puuid]
        );
        
        // Handle case when no matches exist
        const stats = result.rows[0];
        if (stats.total_games === 0) {
            return res.json({
                total_games: 0,
                wins: 0,
                losses: 0,
                win_rate: 0,
                avg_kda: 0,
                favorite_champion: 'None',
                total_kills: 0,
                total_deaths: 0,
                total_assists: 0,
                avg_cs: 0,
                avg_gold: 0,
                avg_damage: 0
            });
        }
        
        res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

//Get matches by champion
app.get('/players/:puuid/champions/:champion', async (req, res) => {
  try {
    const { puuid, champion } = req.params;
    
    const result = await pool.query(
      `SELECT * FROM matches 
       WHERE puuid = $1 AND champion = $2 
       ORDER BY game_start DESC`,
      [puuid, champion]
    );
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/players/:puuid/update-stats', async (req, res) => {
  try {
    const { puuid } = req.params;
    
    const result = await pool.query(
      `INSERT INTO player_stats (puuid, total_games, wins, losses, win_rate, avg_kda, favorite_champion)
       SELECT 
         puuid,
         COUNT(*) as total_games,
         COUNT(CASE WHEN win = true THEN 1 END) as wins,
         COUNT(CASE WHEN win = false THEN 1 END) as losses,
         ROUND(COUNT(CASE WHEN win = true THEN 1 END) * 100.0 / COUNT(*), 2) as win_rate,
         ROUND(AVG(kda), 2) as avg_kda,
         MODE() WITHIN GROUP (ORDER BY champion) as favorite_champion
       FROM matches 
       WHERE puuid = $1
       GROUP BY puuid
       ON CONFLICT (puuid) 
       DO UPDATE SET 
         total_games = EXCLUDED.total_games,
         wins = EXCLUDED.wins,
         losses = EXCLUDED.losses,
         win_rate = EXCLUDED.win_rate,
         avg_kda = EXCLUDED.avg_kda,
         favorite_champion = EXCLUDED.favorite_champion,
         last_updated = CURRENT_TIMESTAMP
       RETURNING *`,
      [puuid]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ 
    message: 'League of Legends API Server is running!',
    endpoints: [
      '/api/account/:gameName/:tagLine',
      '/players/:puuid/matches',
      '/matches/:matchId',
      '/players/:puuid/stats'
    ]
  });
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});