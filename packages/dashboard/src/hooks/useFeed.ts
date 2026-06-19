import { useSocket } from '../context/SocketProvider.js';

export function useFeed() {
  const { feedEvents, connected } = useSocket();
  return { feedEvents, connected };
}
