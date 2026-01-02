const isWhite = (piece) => piece && piece === piece.toUpperCase();
const getOpponentColor = (color) => (color === 'white' ? 'black' : 'white');

function findKing(board, kingColor) {
  const kingPiece = kingColor === 'white' ? 'K' : 'k';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === kingPiece) {
        return [r, c];
      }
    }
  }
  return null;
}

// MODIFIED: Now accepts the isValidMove function as a parameter
function isSquareAttacked(board, square, attackerColor, isValidMove) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && (isWhite(piece) ? 'white' : 'black') === attackerColor) {
        // Now calls the passed-in validation function (which can be C++ or JS)
        if (isValidMove(board, [r, c], square, attackerColor, true)) {
          return true;
        }
      }
    }
  }
  return false;
}

// MODIFIED: Accepts isValidMove and passes it to isSquareAttacked
export function isKingInCheck(board, kingColor, isValidMove) {
  const kingPos = findKing(board, kingColor);
  if (!kingPos) return false;
  return isSquareAttacked(board, kingPos, getOpponentColor(kingColor), isValidMove);
}

// MODIFIED: Accepts isValidMove to check all possible moves
function getAllLegalMoves(board, playerColor, isValidMove) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] && (isWhite(board[r][c]) ? 'white' : 'black') === playerColor) {
        for (let tr = 0; tr < 8; tr++) {
          for (let tc = 0; tc < 8; tc++) {
            if (isValidMove(board, [r, c], [tr, tc], playerColor)) {
              moves.push({ from: [r, c], to: [tr, tc] });
            }
          }
        }
      }
    }
  }
  return moves;
}

// MODIFIED: Accepts isValidMove and passes it to its own helpers
export function getGameStatus(board, playerColor, isValidMove) {
    const legalMoves = getAllLegalMoves(board, playerColor, isValidMove);
    if (legalMoves.length > 0) return null;

    const inCheck = isKingInCheck(board, playerColor, isValidMove);
    if (inCheck) {
        return { winner: getOpponentColor(playerColor), reason: 'Checkmate' };
    } else {
        return { winner: 'draw', reason: 'Stalemate' };
    }
}

