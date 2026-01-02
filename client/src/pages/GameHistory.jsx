import React, { useState, useEffect } from 'react';

const styles = {
  container: { backgroundColor: '#f0f0f0', padding: '1rem', borderRadius: '8px', marginTop: '2rem' },
  title: { marginTop: 0, borderBottom: '2px solid #ccc', paddingBottom: '0.5rem' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '1rem' },
  th: { borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'left', backgroundColor: '#e9e9e9' },
  td: { borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'left' },
  noGames: { textAlign: 'center', color: '#666', marginTop: '1rem' }
};

export default function GameHistory({ token, currentUser }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await fetch('http://localhost:4000/api/games/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch game history.');
        }

        const data = await response.json();
        setHistory(data);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [token]);

  if (!currentUser) return null; // Don't show if user is not logged in

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Game History</h2>
      {loading && <p>Loading history...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && !error && history.length === 0 && (
        <p style={styles.noGames}>No completed games found.</p>
      )}
      {!loading && !error && history.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Opponent</th>
              <th style={styles.th}>Result</th>
              <th style={styles.th}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.map((game) => {
              const myPlayer = game.players.find(p => p.userId === currentUser.id);
              const opponent = game.players.find(p => p.userId !== currentUser.id);
              
              let result = 'Draw';
              if (game.winner !== 'draw') {
                result = game.winner === myPlayer.color ? 'Win' : 'Loss';
              }

              return (
                <tr key={game.gameId}>
                  <td style={styles.td}>{new Date(game.finishedAt).toLocaleDateString()}</td>
                  <td style={styles.td}>{opponent?.username || 'N/A'}</td>
                  <td style={{ ...styles.td, fontWeight: 'bold', color: result === 'Win' ? 'green' : result === 'Loss' ? 'red' : 'inherit' }}>
                    {result}
                  </td>
                  <td style={styles.td}>{game.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
