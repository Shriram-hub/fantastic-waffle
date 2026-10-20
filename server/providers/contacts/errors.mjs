export function contactProviderError(provider,error) {
  const status=error.providerStatus;
  const hints={
    401:'The API key was rejected. Check the server key and the account it belongs to.',
    402:'The account has insufficient credits or requires an eligible plan.',
    403:provider==='Apollo' ? 'This key or account cannot access the endpoint. Check endpoint permissions, plan eligibility and, for free accounts, registration with a work email.' : 'This account cannot access the endpoint. Check its API permissions and plan.',
    422:'The provider rejected these filters. Try a company domain and fewer titles.',
    429:'The provider rate limit or quota was reached. Other contact sources can continue.',
  };
  return Object.assign(new Error(`${provider}: ${hints[status] || (status ? `HTTP ${status}; the request could not complete. Other contact sources can continue.` : error.status ? error.message : 'The request could not complete. Try another contact source.')}`),{status:502,providerStatus:status,provider});
}
