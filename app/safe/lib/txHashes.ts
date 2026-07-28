export type TxBlocks = Record<number, { created: number; executed: number }>;

// The contract stores creation and execution block numbers, so hashes are looked up
// directly: one request per block instead of scanning ranges.
export async function fetchTxHashesByBlocks(
  reader: any,
  blocks: TxBlocks,
  ids: number[]
): Promise<{ created: Record<number, string>; executed: Record<number, string> }> {
  const created: Record<number, string> = {};
  const executed: Record<number, string> = {};

  const createdBlocks = new Set<number>();
  const executedBlocks = new Set<number>();
  for (const id of ids) {
    const b = blocks[id];
    if (!b) continue;
    if (Number.isFinite(b.created) && b.created > 0) createdBlocks.add(b.created);
    if (Number.isFinite(b.executed) && b.executed > 0) executedBlocks.add(b.executed);
  }

  await Promise.all([
    ...Array.from(createdBlocks).map(async (b) => {
      try {
        const logs = await reader.queryFilter(reader.filters.TxCreated(), b, b);
        for (const lg of logs) {
          const id = Number(lg?.args?.id);
          if (Number.isFinite(id) && lg?.transactionHash && created[id] === undefined) {
            created[id] = lg.transactionHash;
          }
        }
      } catch {}
    }),
    ...Array.from(executedBlocks).map(async (b) => {
      try {
        const logs = await reader.queryFilter(reader.filters.TxExecuted(), b, b);
        for (const lg of logs) {
          const id = Number(lg?.args?.id);
          if (Number.isFinite(id) && lg?.transactionHash && executed[id] === undefined) {
            executed[id] = lg.transactionHash;
          }
        }
      } catch {}
    }),
  ]);

  return { created, executed };
}
