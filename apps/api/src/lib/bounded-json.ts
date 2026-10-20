export async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('source_response_too_large'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('source_empty');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('source_response_too_large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
export async function errorHint(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (size < 4096) { const { done, value } = await reader.read(); if (done) break;
    const part = value.subarray(0, 4096 - size); chunks.push(part); size += part.length; }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
