export interface ByteTransport extends AsyncDisposable {
  readonly readable: AsyncIterable<Uint8Array>;
  write(data: Uint8Array, options?: { readonly signal?: AbortSignal }): Promise<void>;
  close(reason?: Error): Promise<void>;
}
