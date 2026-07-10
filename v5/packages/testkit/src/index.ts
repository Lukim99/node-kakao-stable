export function fragmentBytes(data: Uint8Array, sizes: readonly number[]): Uint8Array[] {
  if (sizes.some((size) => !Number.isInteger(size) || size <= 0)) {
    throw new RangeError('fragment sizes must be positive integers');
  }

  const fragments: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    if (offset >= data.byteLength) break;
    fragments.push(data.slice(offset, Math.min(offset + size, data.byteLength)));
    offset += size;
  }
  if (offset < data.byteLength) fragments.push(data.slice(offset));
  return fragments;
}

export async function* asAsyncChunks(chunks: Iterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}
