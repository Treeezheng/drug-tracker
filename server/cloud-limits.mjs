import { isIP, SocketAddress } from 'node:net';
import { CloudError } from './cloud-errors.mjs';

/** Abuse quota identity only, never authentication. Heroku appends its observed IP on the right.
 * https://devcenter.heroku.com/articles/http-routing#heroku-headers
 * proxyMode is server configuration, never selected by a request header.
 */
export function rateSource(req, proxyMode) {
  const forwarded = req.headers['x-forwarded-for'];
  const address = proxyMode === 'heroku'
    ? typeof forwarded === 'string' ? forwarded.split(',').at(-1).trim() : ''
    : req.socket.remoteAddress;
  if (!address || !isIP(address)) throw new CloudError(400, 'The request source could not be verified.');
  // Canonicalize equivalent IPv6 strings so spelling cannot create additional quotas.
  return SocketAddress.parse(address.includes(':') ? `[${address}]:0` : `${address}:0`).address;
}

/** Wait for BOTH handler completion and response flush/close. A disconnect does not cancel SQL. */
export function operationGate(limit, message) {
  let active = 0;
  return (req, res) => {
    if (active >= limit) {
      req.resume();
      res.setHeader('Connection', 'close');
      throw new CloudError(429, message, { retryAfter: 1 });
    }
    active++;
    let released = false, workDone = false, responseDone = res.destroyed || res.writableFinished;
    const release = () => { if (!released && workDone && responseDone) { released = true; active--; } };
    const finishResponse = () => { responseDone = true; release(); };
    res.once('finish', finishResponse); res.once('close', finishResponse);
    return () => { workDone = true; release(); };
  };
}
