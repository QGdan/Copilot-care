import https from 'https';
import {
  HttpGetText,
  MAX_REDIRECTS,
  USER_AGENT,
} from './types';

const getTextByHttps: HttpGetText = async (
  url: string,
  timeoutMs: number,
  redirectsRemaining: number = MAX_REDIRECTS,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json,text/html,*/*',
          'User-Agent': USER_AGENT,
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          location &&
          redirectsRemaining > 0
        ) {
          response.resume();
          if (settled) {
            return;
          }
          settled = true;
          const redirectedUrl = new URL(location, url).toString();
          getTextByHttps(redirectedUrl, timeoutMs, redirectsRemaining - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          if (!settled) {
            settled = true;
            reject(new Error(`HTTP ${statusCode} for ${url}`));
          }
          return;
        }

        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          raw += chunk;
        });
        response.on('end', () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(raw);
        });
      },
    );

    request.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    request.end();
  });

export { getTextByHttps };
