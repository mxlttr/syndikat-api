import axios from 'axios';

type AxiosRequestConfigWithSignal = Parameters<typeof axios.request>[0] & {
  signal?: AbortSignal;
};
type AxiosRequestOptions = Omit<AxiosRequestConfigWithSignal, 'method' | 'url'>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;

const http = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  headers: {
    'User-Agent': 'syndikat-api/1.0',
  },
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as Error & { code?: string }).code === 'ERR_CANCELED')
  );
}

export function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  const error = new Error('Request aborted');
  error.name = 'AbortError';
  throw error;
}

function shouldRetry(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (!status) return true; // network error / timeout
  return status === 429 || status >= 500;
}

async function requestWithRetry<T>(
  config: AxiosRequestConfigWithSignal,
  retries = DEFAULT_RETRIES,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      throwIfAborted(config.signal);
      const response = await http.request(config);
      return response.data as T;
    } catch (error) {
      lastError = error;
      if (isAbortError(error)) {
        throw error;
      }
      if (!shouldRetry(error) || attempt === retries) {
        throw error;
      }
      const delay = DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError;
}

export async function getText(url: string, config?: AxiosRequestOptions): Promise<string> {
  return requestWithRetry<string>({ url, method: 'GET', responseType: 'text', ...config });
}

export async function getJson<T>(url: string, config?: AxiosRequestOptions): Promise<T> {
  return requestWithRetry<T>({ url, method: 'GET', responseType: 'json', ...config });
}

export async function postJson<T>(
  url: string,
  data: unknown,
  config?: AxiosRequestOptions,
): Promise<T> {
  return requestWithRetry<T>({ url, method: 'POST', data, responseType: 'json', ...config });
}

export { http, requestWithRetry };
