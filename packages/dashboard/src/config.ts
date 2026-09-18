export const dashboardClientConfig = {
  /**
   * Pin the electorate boundary dataset to an election year, e.g. `2026`.
   * When unset the map picks the year whose electorate names best cover the
   * results it is rendering, so dev against 2023 data still draws 2023
   * boundaries without configuration.
   */
  boundaryYear: import.meta.env.VITE_ELECTION_YEAR as string | undefined,
};
