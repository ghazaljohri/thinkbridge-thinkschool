export interface PagedResult<T> {
  page: number;
  size: number;
  total: number;
  items: T[];
}
