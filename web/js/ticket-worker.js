// Solves work tickets off the main thread so the screen never freezes.
import { solveTicket } from './ticket.js';

self.onmessage = (e) => {
  const { code, minute, difficulty } = e.data;
  self.postMessage({ nonce: solveTicket(code, minute, difficulty) });
};
