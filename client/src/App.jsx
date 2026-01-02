import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

// --- Inlined EVENTS object to fix build path error ---
const EVENTS = {
  CONNECTION_OK: 'connection:ok', PING: 'ping', PONG: 'pong', GAME_CREATE: 'game:create',
  GAME_CREATED: 'game:created', GAME_JOIN: 'game:join', GAME_JOINED: 'game:joined',
  GAME_STATE: 'game:state', GAME_MOVE: 'game:move', GAME_OVER: 'game:over',
  GAME_ERROR: 'game:error', ERROR: 'error',
  GAME_FIND: 'game:find',
  GAME_FINDING: 'game:finding'
};


// --- GameHistory Component (Inlined to avoid path issues) ---
const GameHistory = ({ token, currentUser }) => {
  const styles = {
    container: { backgroundColor: '#f0f0f0', padding: '1rem', borderRadius: '8px', marginTop: '2rem' },
    title: { marginTop: 0, borderBottom: '2px solid #ccc', paddingBottom: '0.5rem' },
    table: { width: '100%', borderCollapse: 'collapse', marginTop: '1rem' },
    th: { borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'left', backgroundColor: '#e9e9e9' },
    td: { borderBottom: '1px solid #ddd', padding: '8px', textAlign: 'left' },
    noGames: { textAlign: 'center', color: '#666', marginTop: '1rem' }
  };

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

        if (!response.ok) throw new Error('Failed to fetch game history.');
        
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

  if (!currentUser) return null;

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
              let result = game.winner === 'draw' ? 'Draw' : (game.winner === myPlayer?.color ? 'Win' : 'Loss');

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
};


// --- Main App Component ---

let socket = null;
function connectSocket(token) {
  if (!token) { console.warn("No auth token"); return; }
  if (socket && socket.connected) { socket.disconnect(); }
  socket = io('http://localhost:4000', { auth: { token } });
  return socket;
}

const clientChessLogic = {
    isWhite: (piece) => piece && piece === piece.toUpperCase(),
    getLegalMovesForPiece: (board, from) => {
        const [fromRow, fromCol] = from;
        const piece = board[fromRow][fromCol];
        if (!piece) return [];
        const moves = [];
        for(let r=0; r<8; r++) {
            for(let c=0; c<8; c++) {
                if (clientChessLogic.isPseudoLegal(board, from, [r, c])) {
                    moves.push([r, c]);
                }
            }
        }
        return moves;
    },
    isPseudoLegal: (board, from, to) => {
        const [fromRow, fromCol] = from; const [toRow, toCol] = to;
        const piece = board[fromRow][fromCol]; const targetPiece = board[toRow][toCol];
        if (targetPiece && (clientChessLogic.isWhite(piece) === clientChessLogic.isWhite(targetPiece))) return false;
        const pieceType = piece.toLowerCase();
        const rowDiff = Math.abs(fromRow-toRow); const colDiff = Math.abs(fromCol-toCol);
        
        function isPathClear() {
            const rStep = Math.sign(toRow - fromRow); const cStep = Math.sign(toCol-fromCol);
            let r = fromRow + rStep; let c = fromCol + cStep;
            while (r !== toRow || c !== toCol) { if (board[r][c]) return false; r+=rStep; c+=cStep; }
            return true;
        }

        switch (pieceType) {
            case 'p':
                const dir = clientChessLogic.isWhite(piece) ? -1 : 1;
                const startRow = clientChessLogic.isWhite(piece) ? 6 : 1;
                if (fromCol === toCol && !targetPiece) {
                    if (toRow === fromRow + dir) return true;
                    if (fromRow === startRow && toRow === fromRow + 2 * dir && !board[fromRow+dir][fromCol]) return true;
                } else if (colDiff === 1 && toRow === fromRow + dir && targetPiece) return true;
                return false;
            case 'r': return (rowDiff === 0 || colDiff === 0) && isPathClear();
            case 'n': return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
            case 'b': return rowDiff === colDiff && isPathClear();
            case 'q': return (rowDiff === 0 || colDiff === 0 || rowDiff === colDiff) && isPathClear();
            case 'k': return rowDiff <= 1 && colDiff <= 1;
        }
        return false;
    }
};

const pieceSymbols = {
    'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚',
    'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔'
};

const styles = {
  button: { backgroundColor: '#507a55', color: 'white', border: 'none', padding: '10px 18px', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', transition: 'background-color 0.2s ease' },
  disabledButton: { backgroundColor: '#9e9e9e', cursor: 'not-allowed' },
  input: { padding: '9px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '16px', flexGrow: 1 },
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [gameId, setGameId] = useState('');
  const [joinGameId, setJoinGameId] = useState('');
  const [status, setStatus] = useState('Connect to start');
  const [playerColor, setPlayerColor] = useState(null);
  const [board, setBoard] = useState(Array(8).fill(Array(8).fill('')));
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [turn, setTurn] = useState('white');
  const [kingInCheck, setKingInCheck] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState(null);
  const [isFindingGame, setIsFindingGame] = useState(false);
  
  const E = useMemo(() => EVENTS, []);

  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser({ id: payload.id, username: payload.username });
      } catch (e) {
        console.error("Failed to decode token", e);
        setToken(null);
        localStorage.removeItem('token');
      }
    }
    
    const s = connectSocket(token);
    if (!s) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onGameCreated = ({ gameId }) => { setIsFindingGame(false); setGameId(gameId); setPlayerColor('white'); setStatus(`Game ID: ${gameId}. Waiting...`); setBoard(initialBoard()); };
    const onGameJoined = ({ gameId, color, board }) => { setIsFindingGame(false); setGameId(gameId); setPlayerColor(color); setBoard(board); };
    const onGameState = (state) => { setBoard(state.board); setTurn(state.turn); setKingInCheck(state.check); setStatus(`It's ${state.turn}'s turn.`); };
    const onGameError = ({ message }) => { setIsFindingGame(false); setStatus(`Error: ${message}`); };
    const onGameOver = (result) => setGameOver(result);
    const onGameFinding = () => { setIsFindingGame(true); setStatus('Searching for an opponent...'); };
    
    s.on('connect', onConnect); s.on('disconnect', onDisconnect);
    s.on(E.GAME_CREATED, onGameCreated); s.on(E.GAME_JOINED, onGameJoined);
    s.on(E.GAME_STATE, onGameState); s.on(E.GAME_ERROR, onGameError);
    s.on(E.GAME_OVER, onGameOver);
    s.on(E.GAME_FINDING, onGameFinding);

    return () => { s.off('connect'); s.off('disconnect'); s.off(E.GAME_CREATED); s.off(E.GAME_JOINED); s.off(E.GAME_STATE); s.off(E.GAME_ERROR); s.off(E.GAME_OVER); s.off(E.GAME_FINDING); };
  }, [token, E]);
  
  const initialBoard = () => [
    ['r','n','b','q','k','b','n','r'], ['p','p','p','p','p','p','p','p'],
    ['','','','','','','',''], ['','','','','','','',''],
    ['','','','','','','',''],['','','','','','','',''],
    ['P','P','P','P','P','P','P','P'], ['R','N','B','Q','K','B','N','R']
  ];

  const handleSquareClick = (row, col) => {
    if (!gameId || turn !== playerColor || gameOver) return;
    const piece = board[row][col];
    
    if (selectedSquare) {
      if (legalMoves.some(m => m[0] === row && m[1] === col)) {
        socket.emit(E.GAME_MOVE, { gameId, from: selectedSquare, to: [row, col] });
      }
      setSelectedSquare(null);
      setLegalMoves([]);
    } else if (piece) {
      const isMyPiece = (playerColor === 'white' && clientChessLogic.isWhite(piece)) || (playerColor === 'black' && !clientChessLogic.isWhite(piece));
      if (isMyPiece) {
        setSelectedSquare([row, col]);
        setLegalMoves(clientChessLogic.getLegalMovesForPiece(board, [row, col]));
      }
    }
  };
  
  const findKingPos = useMemo(() => {
    if(!kingInCheck) return null;
    const kingPiece = kingInCheck === 'white' ? 'K' : 'k';
    for(let r=0; r<8; r++) for(let c=0; c<8; c++) if(board[r][c] === kingPiece) return [r,c];
    return null;
  }, [board, kingInCheck]);

  const handleJoinGame = () => {
    if (joinGameId) {
      socket?.emit(E.GAME_JOIN, { gameId: joinGameId });
    }
  };

  const Chessboard = () => {
    const displayBoard = playerColor === 'black' ? [...board].reverse().map(r => [...r].reverse()) : board;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 60px)', width: 480, border: '2px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
        {displayBoard.flat().map((piece, index) => {
          const row = Math.floor(index / 8);
          const col = index % 8;
          const originalRow = playerColor === 'black' ? 7 - row : row;
          const originalCol = playerColor === 'black' ? 7 - col : col;
          
          const isSelected = selectedSquare && selectedSquare[0] === originalRow && selectedSquare[1] === originalCol;
          const isLegalMove = legalMoves.some(m => m[0] === originalRow && m[1] === originalCol);
          const isCheck = findKingPos && findKingPos[0] === originalRow && findKingPos[1] === originalCol;
          
          let bgColor = (row + col) % 2 === 1 ? '#769656' : '#eeeed2';
          if (isSelected) bgColor = '#f6f669';
          if (isCheck) bgColor = '#ff7f7f';

          return (
            <div key={index} onClick={() => handleSquareClick(originalRow, originalCol)} style={{ width: 60, height: 60, backgroundColor: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, cursor: 'pointer', position: 'relative' }}>
              <span style={{ textShadow: '0 0 3px rgba(0,0,0,0.5)' }}>{pieceSymbols[piece]}</span>
              {isLegalMove && <div style={{position: 'absolute', width: 20, height: 20, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: '50%'}}/>}
            </div>
          );
        })}
      </div>
    );
  };
  
  const GameOverModal = () => !gameOver ? null : (
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div style={{ padding: '2rem 3rem', backgroundColor: 'white', borderRadius: '12px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
              <h2 style={{marginTop: 0, fontSize: '24px'}}>Game Over</h2>
              <p style={{fontSize: '18px', margin: '1rem 0 2rem 0'}}>{gameOver.winner === 'draw' ? `Draw by ${gameOver.reason}!` : `Winner: ${gameOver.winner} by ${gameOver.reason}!`}</p>
              <button style={styles.button} onClick={() => window.location.reload()}>Play Again</button>
          </div>
      </div>
  );
  
  const createButtonDisabled = !connected || !!gameId || isFindingGame;
  const joinButtonDisabled = !connected || !!gameId || !joinGameId || isFindingGame;
  const findButtonDisabled = !connected || !!gameId || isFindingGame;

  return (
    <div style={{ maxWidth: 640, margin: '2rem auto', fontFamily: 'system-ui', color: '#333' }}>
      <h1 style={{ textAlign: 'center' }}>MERN Real-Time Chess</h1>
      <div style={{ backgroundColor: '#f0f0f0', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
        <p>Socket: <span style={{ color: connected ? 'green' : 'red', fontWeight: 'bold' }}>{connected ? 'Connected' : 'Disconnected'}</span></p>
        <p><strong>{status}</strong></p>
        {gameId && <p>Game ID: <code style={{backgroundColor: '#e0e0e0', padding: '2px 6px', borderRadius: '4px'}}>{gameId}</code> | You are: <strong>{playerColor}</strong></p>}
      </div>
      
      <div style={{ display: 'flex', gap: '12px', margin: '1rem 0', alignItems: 'center' }}>
        <button 
          onClick={() => socket?.emit(E.GAME_CREATE)} 
          disabled={createButtonDisabled}
          style={{...styles.button, ...(createButtonDisabled && styles.disabledButton)}}>
          Create Game
        </button>
        {/* --- ADDED: Find Game Button --- */}
        <button 
          onClick={() => socket?.emit(E.GAME_FIND)} 
          disabled={findButtonDisabled}
          style={{...styles.button, ...(findButtonDisabled && styles.disabledButton), backgroundColor: '#3b82f6'}}>
          Find Game
        </button>
        <div style={{flexGrow: 1, display: 'flex', gap: '8px'}}>
          <input 
            type="text" 
            value={joinGameId} 
            onChange={(e) => setJoinGameId(e.target.value)} 
            placeholder="Enter Game ID" 
            style={styles.input}
            disabled={!connected || !!gameId || isFindingGame}
          />
          <button 
            onClick={handleJoinGame} 
            disabled={joinButtonDisabled}
            style={{...styles.button, ...(joinButtonDisabled && styles.disabledButton)}}>
            Join Game
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}><Chessboard /></div>
      <GameOverModal />
      
      {/* --- RENDER GAME HISTORY --- */}
      <GameHistory token={token} currentUser={currentUser} />
    </div>
  );
}

