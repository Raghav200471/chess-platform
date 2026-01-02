#include <vector>
#include <string>
#include <cmath>
#include <emscripten.h>
#include <stdlib.h> // Required for malloc and free

// --- Helper Functions ---
bool isWhite(char p) {
    return p >= 'A' && p <= 'Z';
}

bool isPathClear(const std::vector<char>& board, int fromRow, int fromCol, int toRow, int toCol) {
    int rowStep = (toRow > fromRow) ? 1 : ((toRow < fromRow) ? -1 : 0);
    int colStep = (toCol > fromCol) ? 1 : ((toCol < fromCol) ? -1 : 0);
    int r = fromRow + rowStep;
    int c = fromCol + colStep;
    while (r != toRow || c != toCol) {
        if (board[r * 8 + c] != ' ') return false;
        r += rowStep;
        c += colStep;
    }
    return true;
}

// Use C-style linkage for compatibility
extern "C" {

EMSCRIPTEN_KEEPALIVE
bool isValidMove(char* board_ptr, int fromRow, int fromCol, int toRow, int toCol, bool isWhiteTurn) {
    std::vector<char> board(board_ptr, board_ptr + 64);
    
    char piece = board[fromRow * 8 + fromCol];
    char targetPiece = board[toRow * 8 + toCol];

    if (piece == ' ') return false;
    if (isWhiteTurn != isWhite(piece)) return false;
    if (targetPiece != ' ' && isWhite(piece) == isWhite(targetPiece)) return false;

    char pieceType = tolower(piece);
    int rowDiff = std::abs(fromRow - toRow);
    int colDiff = std::abs(fromCol - toCol);

    bool pseudoLegal = false;
    switch (pieceType) {
        case 'p': {
            int direction = isWhite(piece) ? -1 : 1;
            int startRow = isWhite(piece) ? 6 : 1;
            if (fromCol == toCol && targetPiece == ' ') { // Move forward
                if (toRow == fromRow + direction) pseudoLegal = true;
                if (fromRow == startRow && toRow == fromRow + 2 * direction && board[(fromRow + direction) * 8 + fromCol] == ' ') pseudoLegal = true;
            } else if (colDiff == 1 && rowDiff == 1 && toRow == fromRow + direction && targetPiece != ' ') { // Capture
                pseudoLegal = true;
            }
            break;
        }
        case 'r':
            if (rowDiff == 0 || colDiff == 0) pseudoLegal = isPathClear(board, fromRow, fromCol, toRow, toCol);
            break;
        case 'n':
            pseudoLegal = (rowDiff == 2 && colDiff == 1) || (rowDiff == 1 && colDiff == 2);
            break;
        case 'b':
            if (rowDiff == colDiff) pseudoLegal = isPathClear(board, fromRow, fromCol, toRow, toCol);
            break;
        case 'q':
            if (rowDiff == colDiff || rowDiff == 0 || colDiff == 0) pseudoLegal = isPathClear(board, fromRow, fromCol, toRow, toCol);
            break;
        case 'k':
            pseudoLegal = (rowDiff <= 1 && colDiff <= 1) && !(rowDiff == 0 && colDiff == 0);
            break;

    }
    
    return pseudoLegal;
}

// Expose standard memory management functions
EMSCRIPTEN_KEEPALIVE
void* wasm_malloc(size_t size) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE
void wasm_free(void* ptr) {
    free(ptr);
}

} // extern "C"

