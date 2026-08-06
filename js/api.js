async function request(path, options = {}) {
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(data?.error || 'Something went wrong. Please try again.');
    }
    return data;
}

export const api = {
    getSession: () => request('/api/session'),
    register: (body) => request('/api/auth/register', { method: 'POST', body }),
    login: (body) => request('/api/auth/login', { method: 'POST', body }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    getMyProfile: () => request('/api/profile/me'),
    updateProfile: (body) => request('/api/profile/me', { method: 'PUT', body }),
    getProfile: (username) => request(`/api/profiles/${encodeURIComponent(username)}`),
    getLevels: () => request('/api/levels'),
    getSubmissions: () => request('/api/submissions'),
    submitLevel: (body) => request('/api/submissions/level', { method: 'POST', body }),
    submitRun: (body) => request('/api/submissions/run', { method: 'POST', body }),
    getAdminSubmissions: (status = 'pending') => request(`/api/admin/submissions?status=${encodeURIComponent(status)}`),
    reviewSubmission: (id, body) => request(`/api/admin/submissions/${id}/review`, { method: 'POST', body }),
    findUsers: (query = '') => request(`/api/admin/users?query=${encodeURIComponent(query)}`),
    updateRole: (id, role) => request(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } }),
};
