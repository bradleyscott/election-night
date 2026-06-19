import { useSocket } from '../context/SocketProvider.js';

export function useResults() {
  const { results, connected } = useSocket();
  return { results, connected };
}
