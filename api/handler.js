import { handleRequest } from '../server.mjs';

function routePath(value) {
    if (Array.isArray(value)) {
        return value.join('/');
    }
    return String(value || '').replace(/^\/+/, '');
}

// Vercel rewrites every /api/* request here. Rebuild the original API path so
// the shared Node handler can use the exact same routing locally and on Vercel.
export default async function handler(request, response) {
    const requestUrl = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);
    const path = routePath(request.query?.path || requestUrl.searchParams.get('path'));
    requestUrl.pathname = `/api/${path}`;
    requestUrl.searchParams.delete('path');
    request.url = `${requestUrl.pathname}${requestUrl.search}`;
    return handleRequest(request, response);
}
