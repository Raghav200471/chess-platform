export const EVENTS = {
  CONNECTION_OK: 'connection:ok',
  PING: 'ping',
  PONG: 'pong',
  GAME_CREATE: 'game:create',
  GAME_CREATED: 'game:created',
  GAME_JOIN: 'game:join',
  GAME_JOINED: 'game:joined',
  GAME_STATE: 'game:state',
  GAME_MOVE: 'game:move',
  GAME_OVER: 'game:over',
  GAME_ERROR: 'game:error',
  ERROR: 'error',
  GAME_FIND: 'game:find',
  GAME_FINDING: 'game:finding'
};

export const ROOMS = {
  game: (id) => `game:${id}`,
};
