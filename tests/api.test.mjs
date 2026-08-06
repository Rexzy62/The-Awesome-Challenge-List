import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

async function unusedPort() {
    const server = createNetServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    server.close();
    await once(server, 'close');
    return port;
}

const testDatabaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();

test('profile linking, submissions, and admin approval workflow', { skip: !testDatabaseUrl }, async (t) => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'tacl-api-'));
    const port = await unusedPort();
    const child = spawn(process.execPath, ['server.mjs'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PORT: String(port),
            DATABASE_URL: testDatabaseUrl,
            AUTH_SECRET: 'a test-only secret that is long enough to be safe',
            BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const started = new Promise((resolve, reject) => {
        child.stdout.on('data', (data) => String(data).includes('TaCL is running') && resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Server exited early (${code}).`)));
    });
    await started;
    t.after(async () => {
        child.kill();
        await once(child, 'exit');
        await rm(tempDirectory, { recursive: true, force: true });
    });

    const request = async (path, { method = 'GET', body, cookie } = {}) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { response, body: response.status === 204 ? null : await response.json() };
    };

    const regularRegister = await request('/api/auth/register', {
        method: 'POST',
        body: { username: 'player_one', email: 'player@example.test', password: 'long-password' },
    });
    assert.equal(regularRegister.response.status, 201);
    const playerCookie = regularRegister.response.headers.getSetCookie()[0].split(';')[0];

    const profileUpdate = await request('/api/profile/me', {
        method: 'PUT',
        cookie: playerCookie,
        body: { displayName: 'Player One', identityName: 'Rexzy', countryCode: 'DE', bio: '<script>nope</script>TaCL player', featuredCompletionId: '' },
    });
    assert.equal(profileUpdate.response.status, 200);
    assert.equal(profileUpdate.body.user.bio.includes('<script>'), false);
    assert.ok(profileUpdate.body.user.completions.length > 0, 'known repository records should auto-link');

    const levels = await request('/api/levels');
    assert.equal(levels.response.status, 200);
    assert.ok(levels.body.levels.length > 0);
    const levelId = levels.body.levels[0].internalId;

    const runSubmission = await request('/api/submissions/run', {
        method: 'POST',
        cookie: playerCookie,
        body: { levelId, videoProofUrl: 'https://youtu.be/abcdefghijk', progressPercent: 100, rawFootageUrl: '', notes: 'E2E test run' },
    });
    assert.equal(runSubmission.response.status, 201);
    const runId = runSubmission.body.submission.id;

    const levelSubmission = await request('/api/submissions/level', {
        method: 'POST',
        cookie: playerCookie,
        body: { levelName: 'Test Challenge', gdId: '999999999', creatorName: 'Player One', songReference: '12345', videoProofUrl: 'https://www.youtube.com/watch?v=abcdefghijk', notes: 'E2E test level' },
    });
    assert.equal(levelSubmission.response.status, 201);

    const forbiddenQueue = await request('/api/admin/submissions', { cookie: playerCookie });
    assert.equal(forbiddenQueue.response.status, 403);

    const adminRegister = await request('/api/auth/register', {
        method: 'POST',
        body: { username: 'list_admin', email: 'admin@example.test', password: 'another-long-password' },
    });
    assert.equal(adminRegister.body.user.role, 'admin');
    const adminCookie = adminRegister.response.headers.getSetCookie()[0].split(';')[0];

    const pending = await request('/api/admin/submissions', { cookie: adminCookie });
    assert.equal(pending.response.status, 200);
    assert.equal(pending.body.submissions.length, 2);
    for (const submission of pending.body.submissions) {
        const reviewed = await request(`/api/admin/submissions/${submission.id}/review`, {
            method: 'POST',
            cookie: adminCookie,
            body: { decision: 'approved', reviewNotes: 'Verified by integration test.' },
        });
        assert.equal(reviewed.response.status, 200);
    }

    const ownSubmissions = await request('/api/submissions', { cookie: playerCookie });
    assert.equal(ownSubmissions.body.submissions.find((submission) => submission.id === runId).status, 'approved');
    const updatedLevels = await request('/api/levels');
    assert.ok(updatedLevels.body.levels.some((level) => level.name === 'Test Challenge'));
    const leaderboard = await request('/api/leaderboard');
    assert.ok(leaderboard.body.leaderboard.some((entry) => entry.user === 'Player One'));

    const users = await request('/api/admin/users?query=player', { cookie: adminCookie });
    assert.equal(users.response.status, 200);
    assert.equal(users.body.users.length, 1);
    const promoted = await request(`/api/admin/users/${users.body.users[0].id}/role`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: { role: 'moderator' },
    });
    assert.equal(promoted.response.status, 200);
});
