export const dashboardClientConfig = {
  wsUrl:
    import.meta.env.VITE_WS_URL ??
    `${window.location.protocol}//${window.location.host}`,
};
