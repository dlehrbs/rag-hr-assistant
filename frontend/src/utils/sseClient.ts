const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function tryRefreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const fetchSSE = async (
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: RequestCredentials;
    signal?: AbortSignal;
    onMessage: (chunk: string) => void;
    onFinished: () => void;
    onError?: (error: any) => void;
  },
  _retried = false
): Promise<void> => {
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body,
      credentials: options.credentials,
      signal: options.signal,
    });

    if (!response.body) throw new Error('ReadableStream not supported in this browser.');

    if (response.status === 401 && !_retried) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        return fetchSSE(url, options, true);
      }
      throw new Error('Server returned 401');
    }

    if (!response.ok) throw new Error(`Server returned ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              done = true;
              break;
            }
            options.onMessage(data.replace(/\\n/g, '\n'));
          }
        }
      }
    }
  } catch (err) {
    if (options.onError) {
      options.onError(err);
    } else {
      console.error('SSE Error:', err);
    }
  } finally {
    options.onFinished();
  }
};
