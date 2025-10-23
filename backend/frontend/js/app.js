async function searchPlayer() {
    const gameName = document.getElementById('gameName').value;
    const tagLine = document.getElementById('tagLine').value;
    
    if (!gameName || !tagLine) {
        alert('Please enter both game name and tag line');
        return;
    }
    
    try {
        const response = await fetch(`/api/search/${gameName}/${tagLine}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error);
        }
        
        await fetch(`/api/players/${data.puuid}/fetch-matches`, { method: 'POST' });
        // Get profile icon URL from Riot
        const profileIconUrl = `https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${data.player.profile_icon_id}.png`;
        
        // Display player info immediately
        document.getElementById('results').innerHTML = `
            <div class="result">
                <div class="player-header">
                    <img src="${profileIconUrl}" alt="Profile Icon" class="profile-icon">
                    <div class="player-info">
                        <h3>Player Found!</h3>
                        <p><strong>Name:</strong> ${data.player.game_name}#${data.player.tag_line}</p>
                        <p><strong>Level:</strong> ${data.player.summoner_level}</p>
                    </div>
                </div>
            </div>
            
            <!-- Stats will be loaded here automatically -->
            <div id="stats-container"></div>
            
            <!-- Matches will be loaded here automatically -->
            <div id="matches-container"></div>
        `;
        
        // Automatically load stats and matches
        await loadStats(data.puuid);
        await loadMatches(data.puuid);
        
    } catch (error) {
        document.getElementById('results').innerHTML = `<div class="result">Error: ${error.message}</div>`;
    }
}
async function loadMatches(puuid) {
    try {
        const response = await fetch(`/players/${puuid}/matches`);
        const matchesData = await response.json();
        
        // Check if we got a valid response
        if (!response.ok) {
            throw new Error(matchesData.error || 'Failed to load matches');
        }
        
        let matchesHTML = '<div class="result"><h4>Recent Matches</h4>';
        
        // Check if matchesData is an array and has items
        if (!Array.isArray(matchesData)) {
            console.error('Matches data is not an array:', matchesData);
            matchesHTML += '<p>Invalid matches data received from server.</p>';
        } else if (matchesData.length === 0) {
            matchesHTML += '<p>No matches found in database.</p>';
        } else {
            matchesData.forEach(match => {
                const championIconUrl = `https://ddragon.leagueoflegends.com/cdn/14.1.1/img/champion/${match.champion}.png`;
                matchesHTML += `
                    <div class="match ${match.win ? 'win' : 'loss'}">
                        <div class="match-row">
                            <img src="${championIconUrl}" alt="${match.champion}" class="champion-icon">
                            <div class="match-info">
                                <div class="champion-name">${match.champion}</div>
                                <div class="match-stats">
                                    ${match.win ? '🏆 VICTORY' : '💀 DEFEAT'} | 
                                    KDA: ${match.kills}/${match.deaths}/${match.assists} 
                                    (${((match.kills + match.assists) / Math.max(match.deaths, 1)).toFixed(2)} KDA) |
                                    CS: ${match.cs} |
                                    Gold: ${match.gold.toLocaleString()} |
                                    ${match.game_mode}
                                </div>
                                <div class="match-time">
                                    ${new Date(match.game_start).toLocaleDateString()} • 
                                    ${Math.floor(match.game_duration / 60)}:${(match.game_duration % 60).toString().padStart(2, '0')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        matchesHTML += '</div>';
        document.getElementById('matches-container').innerHTML = matchesHTML;
    } catch (error) {
        console.error('Error loading matches:', error);
        document.getElementById('matches-container').innerHTML = `
            <div class="result">
                <h4>Recent Matches</h4>
                <p>Error loading matches: ${error.message}</p>
                <p><small>Check the browser console for more details.</small></p>
            </div>
        `;
    }
}

async function loadStats(puuid) {
    try {
        const response = await fetch(`/players/${puuid}/stats`);
        const stats = await response.json();
        
        const statsHTML = `
            <div class="result">
                <h4>Player Statistics</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">${stats.win_rate}%</div>
                        <div class="stat-label">Win Rate</div>
                        <div class="stat-detail">${stats.wins}W - ${stats.losses}L</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.avg_kda}</div>
                        <div class="stat-label">Average KDA</div>
                        <div class="stat-detail">${stats.avg_kda} Ratio</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.total_kills}/${stats.total_deaths}/${stats.total_assists}</div>
                        <div class="stat-label">Total KDA</div>
                        <div class="stat-detail">K/D/A</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.total_games}</div>
                        <div class="stat-label">Total Games</div>
                        <div class="stat-detail">Matches Played</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.favorite_champion}</div>
                        <div class="stat-label">Favorite Champion</div>
                        <div class="stat-detail">Most Played</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${stats.avg_cs}</div>
                        <div class="stat-label">Avg CS</div>
                        <div class="stat-detail">Creep Score</div>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('stats-container').innerHTML = statsHTML;
    } catch (error) {
        document.getElementById('stats-container').innerHTML = `<div class="result">Error loading stats: ${error.message}</div>`;
    }
}