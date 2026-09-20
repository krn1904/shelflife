export const DEFAULT_PAGE_SIZE = 1000;

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('pageSize must be a positive integer');
  }

  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}
