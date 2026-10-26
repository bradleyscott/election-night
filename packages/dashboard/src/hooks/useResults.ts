import { useSocket } from '../context/SocketProvider.js';

export function useResults() {
  const { results, connected, resultsUpdatedAt } = useSocket();
  return { results, connected, updatedAt: resultsUpdatedAt };
}
