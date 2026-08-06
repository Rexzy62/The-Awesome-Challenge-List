import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ws from 'ws';
import { Client, neonConfig } from '@neondatabase/serverless';

const root = resolve(process.cwd());
const dataDirectory = join(root, 'data');
const port = Number(process.env.PORT || 8000);
const sessionLifetimeSeconds = 60 * 60 * 24 * 14;
const secureCookies = process.env.NODE_ENV === 'production';
const bootstrapAdminEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const scrypt = promisify(scryptCallback);
const loginAttempts = new Map();
const databaseContext = new AsyncLocalStorage();
let databaseInitialized = false;

// Vercel may run a Node version without a browser-compatible WebSocket global.
// Neon uses WebSockets for the interactive transactions used by approvals.
neonConfig.webSocketConstructor = ws;

function postgresParameters(statement) {
    let index = 0;
    return statement.replace(/\?/g, () => `$${++index}`);
}

class PostgresDatabase {
    constructor(client) {
        this.client = client;
    }

    prepare(statement) {
        const query = postgresParameters(statement);
        return {
            get: async (...parameters) => (await this.client.query(query, parameters)).rows[0] || null,
            all: async (...parameters) => (await this.client.query(query, parameters)).rows,
            run: async (...parameters) => this.client.query(query, parameters),
        };
    }

    async exec(script) {
        const statements = script.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
        for (const statement of statements) {
            await this.client.query(statement);
        }
    }
}

const db = {
    prepare(statement) {
        const database = databaseContext.getStore();
        if (!database) {
            throw new Error('Database access was attempted outside an active request.');
        }
        return database.prepare(statement);
    },
    exec(script) {
        const database = databaseContext.getStore();
        if (!database) {
            throw new Error('Database access was attempted outside an active request.');
        }
        return database.exec(script);
    },
};

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function now() {
    return new Date().toISOString();
}

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function authSecret() {
    const secret = String(process.env.AUTH_SECRET || '').trim();
    if (!secret || secret.length < 32) {
        throw new ApiError(500, 'Server authentication is not configured. Set a strong AUTH_SECRET environment variable.');
    }
    return secret;
}

function signSession(user) {
    const payload = base64Url(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds }));
    const signature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifySession(token) {
    if (!token || typeof token !== 'string') {
        return null;
    }

    const [payload, signature] = token.split('.');
    if (!payload || !signature) {
        return null;
    }

    const expected = createHmac('sha256', authSecret()).update(payload).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
        return null;
    }

    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return parsed.exp > Math.floor(Date.now() / 1000) && typeof parsed.sub === 'string' ? parsed : null;
    } catch {
        return null;
    }
}

function parseCookies(request) {
    return Object.fromEntries(
        String(request.headers.cookie || '')
            .split(';')
            .map((part) => part.trim().split(/=(.*)/s, 2))
            .filter(([key]) => key),
    );
}

function sessionCookie(token) {
    return [
        `tacl_session=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${sessionLifetimeSeconds}`,
        secureCookies ? 'Secure' : '',
    ].filter(Boolean).join('; ');
}

function expiredSessionCookie() {
    return 'tacl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secureCookies ? '; Secure' : '');
}

function sendJson(response, status, value, headers = {}) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
    });
    response.end(JSON.stringify(value));
}

function sendError(response, error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (!(error instanceof ApiError)) {
        console.error(error);
    }
    sendJson(response, status, { error: error instanceof ApiError ? error.message : 'An unexpected server error occurred.' });
}

async function readJsonBody(request) {
    const contentType = String(request.headers['content-type'] || '');
    if (!contentType.includes('application/json')) {
        throw new ApiError(415, 'Requests must use application/json.');
    }

    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 1_000_000) {
            throw new ApiError(413, 'Request body is too large.');
        }
    }

    try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error('not an object');
        }
        return parsed;
    } catch {
        throw new ApiError(400, 'Request body must be a JSON object.');
    }
}

function assertTrustedOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) {
        return;
    }

    try {
        if (new URL(origin).host !== request.headers.host) {
            throw new Error('cross-origin');
        }
    } catch {
        throw new ApiError(403, 'Cross-site requests are not allowed.');
    }
}

function limit(request, bucket, maxAttempts = 12, windowMs = 15 * 60 * 1000) {
    const key = `${bucket}:${request.socket.remoteAddress || 'unknown'}`;
    const cutoff = Date.now() - windowMs;
    const entries = (loginAttempts.get(key) || []).filter((time) => time > cutoff);
    if (entries.length >= maxAttempts) {
        throw new ApiError(429, 'Too many attempts. Please try again later.');
    }
    entries.push(Date.now());
    loginAttempts.set(key, entries);
}

function cleanText(value, label, { min = 0, max = 500, required = false } = {}) {
    if (value === undefined || value === null) {
        if (required) {
            throw new ApiError(400, `${label} is required.`);
        }
        return '';
    }
    if (typeof value !== 'string') {
        throw new ApiError(400, `${label} must be text.`);
    }
    const text = value.replace(/\u0000/g, '').trim();
    if (text.length < min || (required && !text)) {
        throw new ApiError(400, `${label} is too short.`);
    }
    if (text.length > max) {
        throw new ApiError(400, `${label} must be ${max} characters or fewer.`);
    }
    return text;
}

function sanitizeBio(value) {
    const bio = cleanText(value, 'Bio', { max: 1_000 });
    // Bio is always rendered as text, never with v-html. Remove raw HTML tags so
    // pasted HTML cannot become active should rendering change in the future.
    return bio.replace(/<[^>]*>/g, '').trim();
}

function username(value) {
    const result = cleanText(value, 'Username', { min: 3, max: 32, required: true });
    if (!/^[A-Za-z0-9_-]+$/.test(result)) {
        throw new ApiError(400, 'Username may only contain letters, numbers, underscores, and hyphens.');
    }
    return result;
}

function email(value) {
    const result = cleanText(value, 'Email', { min: 5, max: 254, required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
        throw new ApiError(400, 'Enter a valid email address.');
    }
    return result;
}

function password(value) {
    if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
        throw new ApiError(400, 'Password must be between 10 and 128 characters.');
    }
    return value;
}

function country(value) {
    if (!value) {
        return null;
    }
    const code = cleanText(value, 'Nationality', { min: 2, max: 2 }).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
        throw new ApiError(400, 'Nationality must be a two-letter country code.');
    }
    return code;
}

function url(value, label, { required = false, videoOnly = false } = {}) {
    const result = cleanText(value, label, { required, min: required ? 1 : 0, max: 2_048 });
    if (!result) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(result);
    } catch {
        throw new ApiError(400, `${label} must be a valid URL.`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new ApiError(400, `${label} must use http or https.`);
    }
    if (videoOnly) {
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const allowed = host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('twitch.tv');
        if (!allowed) {
            throw new ApiError(400, `${label} must be a YouTube or Twitch URL.`);
        }
    }
    return parsed.toString();
}

function integer(value, label, { min, max }) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new ApiError(400, `${label} must be a whole number between ${min} and ${max}.`);
    }
    return number;
}

function json(value, fallback = []) {
    try {
        return JSON.parse(value || JSON.stringify(fallback));
    } catch {
        return fallback;
    }
}

async function hashPassword(value) {
    const salt = randomBytes(16).toString('base64url');
    const digest = await scrypt(value, salt, 64);
    return `scrypt$${salt}$${Buffer.from(digest).toString('base64url')}`;
}

async function verifyPassword(value, stored) {
    const [algorithm, salt, expected] = String(stored).split('$');
    if (algorithm !== 'scrypt' || !salt || !expected) {
        return false;
    }
    const digest = Buffer.from(await scrypt(value, salt, 64));
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return digest.length === expectedBuffer.length && timingSafeEqual(digest, expectedBuffer);
}

async function dbGetUser(id) {
    return await db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(id) || null;
}

async function authenticatedUser(request) {
    const token = verifySession(parseCookies(request).tacl_session);
    if (!token) {
        return null;
    }
    return dbGetUser(token.sub);
}

async function requireUser(request) {
    const user = await authenticatedUser(request);
    if (!user) {
        throw new ApiError(401, 'Sign in to continue.');
    }
    return user;
}

async function requireRole(request, roles) {
    const user = await requireUser(request);
    if (!roles.includes(user.role)) {
        throw new ApiError(403, 'You do not have permission to perform this action.');
    }
    return user;
}

function score(rank, percent, minimumPercent) {
    if (rank > 150 || (rank > 75 && percent < 100)) {
        return 0;
    }
    const raw = (-24.9975 * Math.pow(rank - 1, 0.4) + 200) * ((percent - (minimumPercent - 1)) / (100 - (minimumPercent - 1)));
    const rounded = (number) => Math.round(number * 1000) / 1000;
    const result = Math.max(0, raw);
    return percent !== 100 ? rounded(result - result / 3) : Math.max(rounded(result), 0);
}

async function migrateAndImportList() {
    await db.exec(readFileSync(join(root, 'db', 'schema.postgres.sql'), 'utf8'));
    const slugs = json(readFileSync(join(dataDirectory, '_list.json'), 'utf8'));
    const stamp = now();

    await db.exec('BEGIN');
    try {
        for (const [index, slug] of slugs.entries()) {
            const level = json(readFileSync(join(dataDirectory, `${slug}.json`), 'utf8'), null);
            if (!level || typeof level !== 'object') {
                continue;
            }
            const existing = await db.prepare('SELECT id FROM levels WHERE source_slug = ?').get(slug);
            const levelId = existing?.id || randomUUID();
            await db.prepare(`
                INSERT INTO levels (id, source_slug, rank_position, name, gd_id, creator_name, creators_json, verifier_name, verification_url, notes, percent_to_qualify, password, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 1, ?, ?)
                ON CONFLICT(source_slug) DO UPDATE SET
                    rank_position = excluded.rank_position, name = excluded.name, gd_id = excluded.gd_id,
                    creator_name = excluded.creator_name, creators_json = excluded.creators_json,
                    verifier_name = excluded.verifier_name, verification_url = excluded.verification_url,
                    percent_to_qualify = excluded.percent_to_qualify, password = excluded.password,
                    active = 1, updated_at = excluded.updated_at
            `).run(
                levelId,
                slug,
                index + 1,
                String(level.name || slug),
                String(level.id || slug),
                String(level.author || 'Unknown'),
                JSON.stringify(Array.isArray(level.creators) ? level.creators : []),
                String(level.verifier || level.author || 'Unknown'),
                typeof level.verification === 'string' ? level.verification : null,
                Math.max(1, Math.min(100, Number(level.percentToQualify) || 100)),
                typeof level.password === 'string' ? level.password : null,
                stamp,
                stamp,
            );

            for (const [recordIndex, record] of (Array.isArray(level.records) ? level.records : []).entries()) {
                if (!record || typeof record !== 'object' || !record.user || !record.link) {
                    continue;
                }
                await db.prepare(`
                    INSERT INTO completions (id, source_key, player_name, level_id, proof_url, progress_percent, notes, refresh_rate, created_at, verified_at)
                    VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
                    ON CONFLICT(source_key) DO UPDATE SET
                        player_name = excluded.player_name, proof_url = excluded.proof_url,
                        progress_percent = excluded.progress_percent, refresh_rate = excluded.refresh_rate
                `).run(
                    randomUUID(),
                    `repository:${slug}:${recordIndex}`,
                    String(record.user),
                    levelId,
                    String(record.link),
                    Math.max(1, Math.min(100, Number(record.percent) || 100)),
                    Number.isInteger(Number(record.hz)) ? Number(record.hz) : null,
                    stamp,
                    stamp,
                );
            }
        }
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

async function linkProfileCompletions(userId, identityName, accountUsername) {
    await db.prepare(`
        UPDATE completions
        SET user_id = ?
        WHERE user_id IS NULL
          AND (lower(player_name) = lower(?) OR lower(player_name) = lower(?))
    `).run(userId, identityName, accountUsername);
}

async function profileForUser(user) {
    const profile = await db.prepare('SELECT display_name, bio, country_code, identity_name, featured_completion_id, updated_at FROM profiles WHERE user_id = ?').get(user.id);
    if (!profile) {
        throw new ApiError(404, 'Profile not found.');
    }
    const completions = (await db.prepare(`
        SELECT c.id, c.player_name, c.proof_url, c.raw_footage_url, c.progress_percent, c.notes, c.verified_at,
               l.id AS level_id, l.name AS level_name, l.rank_position
        FROM completions c
        JOIN levels l ON l.id = c.level_id
        WHERE c.user_id = ? AND l.active = 1
        ORDER BY l.rank_position ASC, c.progress_percent DESC
    `).all(user.id)).map((completion) => ({
        id: completion.id,
        levelId: completion.level_id,
        levelName: completion.level_name,
        rank: completion.rank_position,
        proofUrl: completion.proof_url,
        rawFootageUrl: completion.raw_footage_url,
        progressPercent: completion.progress_percent,
        notes: completion.notes,
        verifiedAt: completion.verified_at,
    }));

    return {
        username: user.username,
        role: user.role,
        displayName: profile.display_name,
        bio: profile.bio,
        countryCode: profile.country_code,
        identityName: profile.identity_name,
        featuredCompletionId: profile.featured_completion_id,
        completions,
        updatedAt: profile.updated_at,
    };
}

async function levelRows() {
    return db.prepare('SELECT * FROM levels WHERE active = 1 ORDER BY rank_position ASC, created_at ASC').all();
}

async function publicLevels() {
    const recordsByLevel = new Map();
    const completionRows = await db.prepare(`
        SELECT c.*, COALESCE(p.display_name, c.player_name) AS public_name
        FROM completions c
        JOIN levels l ON l.id = c.level_id
        LEFT JOIN profiles p ON p.user_id = c.user_id
        WHERE l.active = 1
        ORDER BY c.progress_percent DESC, c.verified_at ASC
    `).all();
    for (const record of completionRows) {
        const records = recordsByLevel.get(record.level_id) || [];
        records.push({
            user: record.public_name,
            link: record.proof_url,
            percent: record.progress_percent,
            hz: record.refresh_rate,
            mobile: false,
        });
        recordsByLevel.set(record.level_id, records);
    }

    return (await levelRows()).map((level) => ({
        id: level.gd_id,
        internalId: level.id,
        path: level.source_slug || level.id,
        name: level.name,
        author: level.creator_name,
        creators: json(level.creators_json),
        verifier: level.verifier_name,
        verification: level.verification_url || 'SOON',
        songReference: level.song_reference,
        notes: level.notes,
        percentToQualify: level.percent_to_qualify,
        password: level.password,
        rank: level.rank_position,
        records: recordsByLevel.get(level.id) || [],
    }));
}

async function publicLeaderboard() {
    const scores = new Map();
    const ensure = (player) => {
        if (!scores.has(player)) {
            scores.set(player, { user: player, verified: [], completed: [], progressed: [] });
        }
        return scores.get(player);
    };

    for (const level of await levelRows()) {
        const rank = level.rank_position;
        const verified = ensure(level.verifier_name);
        verified.verified.push({
            rank,
            level: level.name,
            score: score(rank, 100, level.percent_to_qualify),
            link: level.verification_url || '',
        });
    }

    const completions = await db.prepare(`
        SELECT c.proof_url, c.progress_percent, l.name AS level_name, l.rank_position, l.percent_to_qualify,
               COALESCE(p.display_name, c.player_name) AS player_name
        FROM completions c
        JOIN levels l ON l.id = c.level_id
        LEFT JOIN profiles p ON p.user_id = c.user_id
        WHERE l.active = 1
    `).all();
    for (const completion of completions) {
        const player = ensure(completion.player_name);
        const record = {
            rank: completion.rank_position,
            level: completion.level_name,
            score: score(completion.rank_position, completion.progress_percent, completion.percent_to_qualify),
            link: completion.proof_url,
        };
        if (completion.progress_percent === 100) {
            player.completed.push(record);
        } else {
            player.progressed.push({ ...record, percent: completion.progress_percent });
        }
    }

    return [...scores.values()].map((entry) => ({
        ...entry,
        total: Math.round([...entry.verified, ...entry.completed, ...entry.progressed].reduce((sum, item) => sum + item.score, 0) * 1000) / 1000,
    })).sort((left, right) => right.total - left.total || left.user.localeCompare(right.user));
}

function submissionForAdmin(row) {
    const payload = json(row.payload_json, {});
    return {
        id: row.id,
        type: row.type,
        status: row.status,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        reviewNotes: row.review_notes,
        payload,
        submitter: { id: row.user_id, username: row.username, displayName: row.display_name || row.username },
        reviewer: row.reviewer_id ? { id: row.reviewer_id, username: row.reviewer_username } : null,
    };
}

async function adminSubmissions(status = 'pending') {
    const requestedStatus = ['pending', 'approved', 'rejected', 'all'].includes(status) ? status : 'pending';
    const rows = await db.prepare(`
        SELECT s.*, u.username, p.display_name, reviewer.username AS reviewer_username
        FROM submissions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN profiles p ON p.user_id = u.id
        LEFT JOIN users reviewer ON reviewer.id = s.reviewer_id
        ${requestedStatus === 'all' ? '' : 'WHERE s.status = ?'}
        ORDER BY CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at ASC
        LIMIT 100
    `).all(...(requestedStatus === 'all' ? [] : [requestedStatus]));
    return rows.map(submissionForAdmin);
}

async function ownSubmissions(userId) {
    return (await db.prepare('SELECT id, type, status, payload_json, review_notes, created_at, reviewed_at FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId)).map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        payload: json(row.payload_json, {}),
        reviewNotes: row.review_notes,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
    }));
}

async function register(request, response) {
    assertTrustedOrigin(request);
    limit(request, 'register', 6);
    const body = await readJsonBody(request);
    const accountName = username(body.username);
    const accountEmail = email(body.email);
    const secret = password(body.password);
    const role = bootstrapAdminEmail && accountEmail === bootstrapAdminEmail ? 'admin' : 'user';
    const user = { id: randomUUID(), username: accountName, email: accountEmail, role };
    const stamp = now();
    try {
        await db.exec('BEGIN');
        await db.prepare('INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            user.id, user.username, user.email, await hashPassword(secret), user.role, stamp,
        );
        await db.prepare('INSERT INTO profiles (user_id, display_name, bio, identity_name, updated_at) VALUES (?, ?, ?, ?, ?)').run(
            user.id, user.username, '', user.username, stamp,
        );
        await linkProfileCompletions(user.id, user.username, user.username);
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        if (error?.code === '23505') {
            throw new ApiError(409, 'That username or email address is already registered.');
        }
        throw error;
    }
    sendJson(response, 201, { user: await profileForUser(user) }, { 'Set-Cookie': sessionCookie(signSession(user)) });
}

async function login(request, response) {
    assertTrustedOrigin(request);
    limit(request, 'login');
    const body = await readJsonBody(request);
    const identifier = cleanText(body.identifier, 'Username or email', { min: 3, max: 254, required: true });
    const secret = password(body.password);
    const row = await db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)').get(identifier, identifier);
    if (!row || !(await verifyPassword(secret, row.password_hash))) {
        throw new ApiError(401, 'Invalid username/email or password.');
    }
    const user = await dbGetUser(row.id);
    sendJson(response, 200, { user: await profileForUser(user) }, { 'Set-Cookie': sessionCookie(signSession(user)) });
}

async function updateProfile(request, response) {
    assertTrustedOrigin(request);
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const existing = await profileForUser(user);
    const displayName = cleanText(body.displayName ?? existing.displayName, 'Display name', { min: 1, max: 48, required: true });
    const identityName = cleanText(body.identityName ?? existing.identityName, 'Verified player identity', { min: 1, max: 48, required: true });
    const featuredCompletionId = body.featuredCompletionId || null;
    if (featuredCompletionId && !(await db.prepare('SELECT 1 FROM completions WHERE id = ? AND user_id = ?').get(featuredCompletionId, user.id))) {
        throw new ApiError(400, 'Featured completion must belong to you.');
    }
    await db.prepare(`
        UPDATE profiles SET display_name = ?, bio = ?, country_code = ?, identity_name = ?, featured_completion_id = ?, updated_at = ?
        WHERE user_id = ?
    `).run(
        displayName,
        sanitizeBio(body.bio ?? existing.bio),
        country(body.countryCode ?? existing.countryCode),
        identityName,
        featuredCompletionId,
        now(),
        user.id,
    );
    await linkProfileCompletions(user.id, identityName, user.username);
    sendJson(response, 200, { user: await profileForUser(user) });
}

async function submitLevel(request, response) {
    assertTrustedOrigin(request);
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const levelName = cleanText(body.levelName, 'Level name', { min: 1, max: 100, required: true });
    const gdId = cleanText(body.gdId, 'GD ID', { min: 1, max: 32, required: true });
    if (!/^\d{1,20}$/.test(gdId)) {
        throw new ApiError(400, 'GD ID must be numeric.');
    }
    const creatorName = cleanText(body.creatorName, 'Creator name', { min: 1, max: 64, required: true });
    const songReference = cleanText(body.songReference, 'Song ID or link', { min: 1, max: 2_048, required: true });
    if (!/^\d{1,20}$/.test(songReference)) {
        url(songReference, 'Song ID or link', { required: true });
    }
    const payload = {
        levelName,
        gdId,
        creatorName,
        songReference,
        videoProofUrl: url(body.videoProofUrl, 'Video proof URL', { required: true, videoOnly: true }),
        notes: cleanText(body.notes, 'Description or notes', { max: 2_000 }),
    };
    if (await db.prepare('SELECT 1 FROM levels WHERE gd_id = ?').get(gdId)) {
        throw new ApiError(409, 'A level with this GD ID is already on the active list.');
    }
    const submission = { id: randomUUID(), type: 'level', userId: user.id, status: 'pending', payload: JSON.stringify(payload), stamp: now() };
    await db.prepare('INSERT INTO submissions (id, type, user_id, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        submission.id, submission.type, submission.userId, submission.status, submission.payload, submission.stamp,
    );
    sendJson(response, 201, { submission: { id: submission.id, type: submission.type, status: submission.status, createdAt: submission.stamp } });
}

async function submitRun(request, response) {
    assertTrustedOrigin(request);
    const user = await requireUser(request);
    const body = await readJsonBody(request);
    const levelId = cleanText(body.levelId, 'Level', { min: 1, max: 64, required: true });
    const level = await db.prepare('SELECT id FROM levels WHERE id = ? AND active = 1').get(levelId);
    if (!level) {
        throw new ApiError(400, 'Choose an active challenge-list level.');
    }
    const payload = {
        levelId,
        videoProofUrl: url(body.videoProofUrl, 'Video proof URL', { required: true, videoOnly: true }),
        progressPercent: integer(body.progressPercent, 'Progress percentage', { min: 1, max: 100 }),
        rawFootageUrl: url(body.rawFootageUrl, 'Raw footage link'),
        notes: cleanText(body.notes, 'Notes', { max: 2_000 }),
    };
    const submission = { id: randomUUID(), type: 'run', userId: user.id, status: 'pending', payload: JSON.stringify(payload), stamp: now() };
    await db.prepare('INSERT INTO submissions (id, type, user_id, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        submission.id, submission.type, submission.userId, submission.status, submission.payload, submission.stamp,
    );
    sendJson(response, 201, { submission: { id: submission.id, type: submission.type, status: submission.status, createdAt: submission.stamp } });
}

async function reviewSubmission(request, response, submissionId) {
    assertTrustedOrigin(request);
    const reviewer = await requireRole(request, ['moderator', 'admin']);
    const body = await readJsonBody(request);
    const decision = cleanText(body.decision, 'Decision', { min: 1, max: 16, required: true });
    if (!['approved', 'rejected'].includes(decision)) {
        throw new ApiError(400, 'Decision must be approved or rejected.');
    }
    const reviewNotes = cleanText(body.reviewNotes, 'Review notes', { max: 1_000 });
    const submission = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
    if (!submission) {
        throw new ApiError(404, 'Submission not found.');
    }
    if (submission.status !== 'pending') {
        throw new ApiError(409, 'This submission has already been reviewed.');
    }
    const payload = json(submission.payload_json, {});
    const stamp = now();
    await db.exec('BEGIN');
    try {
        if (decision === 'approved' && submission.type === 'level') {
            if (await db.prepare('SELECT 1 FROM levels WHERE gd_id = ?').get(payload.gdId)) {
                throw new ApiError(409, 'A level with this GD ID already exists.');
            }
            const nextRank = (await db.prepare('SELECT COALESCE(MAX(rank_position), 0) + 1 AS next_rank FROM levels').get()).next_rank;
            await db.prepare(`
                INSERT INTO levels (id, rank_position, name, gd_id, creator_name, verifier_name, song_reference, verification_url, notes, percent_to_qualify, active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 100, 1, ?, ?)
            `).run(randomUUID(), nextRank, payload.levelName, payload.gdId, payload.creatorName, payload.creatorName, payload.songReference, payload.videoProofUrl, payload.notes, stamp, stamp);
        }
        if (decision === 'approved' && submission.type === 'run') {
            const level = await db.prepare('SELECT id FROM levels WHERE id = ? AND active = 1').get(payload.levelId);
            if (!level) {
                throw new ApiError(409, 'The selected level is no longer active.');
            }
            const submitter = await db.prepare(`
                SELECT u.username, p.identity_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
            `).get(submission.user_id);
            await db.prepare(`
                INSERT INTO completions (id, user_id, player_name, level_id, submission_id, proof_url, raw_footage_url, progress_percent, notes, created_at, verified_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(randomUUID(), submission.user_id, submitter.identity_name || submitter.username, payload.levelId, submission.id, payload.videoProofUrl, payload.rawFootageUrl, payload.progressPercent, payload.notes, stamp, stamp);
        }
        await db.prepare('UPDATE submissions SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = ? WHERE id = ?').run(decision, reviewer.id, reviewNotes || null, stamp, submission.id);
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
    sendJson(response, 200, { submission: { id: submission.id, status: decision, reviewNotes, reviewedAt: stamp } });
}

async function updateRole(request, response, userId) {
    assertTrustedOrigin(request);
    const currentUser = await requireRole(request, ['admin']);
    const body = await readJsonBody(request);
    const role = cleanText(body.role, 'Role', { min: 1, max: 16, required: true });
    if (!['user', 'moderator', 'admin'].includes(role)) {
        throw new ApiError(400, 'Role must be user, moderator, or admin.');
    }
    if (currentUser.id === userId && role !== 'admin') {
        throw new ApiError(400, 'You cannot remove your own final admin access.');
    }
    if (!(await db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId))) {
        throw new ApiError(404, 'User not found.');
    }
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    sendJson(response, 200, { user: await profileForUser(await dbGetUser(userId)) });
}

function sendStatic(request, response, pathname) {
    if (!['GET', 'HEAD'].includes(request.method)) {
        throw new ApiError(405, 'Method not allowed.');
    }
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        throw new ApiError(400, 'Invalid path.');
    }
    const requested = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const candidate = normalize(join(root, requested.endsWith('/') ? `${requested}index.html` : requested));
    if (!candidate.startsWith(`${root}${sep}`) || !existsSync(candidate)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        response.end('Not found');
        return;
    }
    const mimeTypes = {
        '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    };
    const content = readFileSync(candidate);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(candidate)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
}

async function handleApi(request, response, pathname, searchParams) {
    if (pathname === '/api/session' && request.method === 'GET') {
        const user = await authenticatedUser(request);
        return sendJson(response, 200, { user: user ? await profileForUser(user) : null });
    }
    if (pathname === '/api/auth/register' && request.method === 'POST') return register(request, response);
    if (pathname === '/api/auth/login' && request.method === 'POST') return login(request, response);
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
        assertTrustedOrigin(request);
        return sendJson(response, 204, null, { 'Set-Cookie': expiredSessionCookie() });
    }
    if (pathname === '/api/profile/me' && request.method === 'GET') return sendJson(response, 200, { user: await profileForUser(await requireUser(request)) });
    if (pathname === '/api/profile/me' && request.method === 'PUT') return updateProfile(request, response);
    if (pathname.startsWith('/api/profiles/') && request.method === 'GET') {
        const accountName = decodeURIComponent(pathname.slice('/api/profiles/'.length));
        const user = await db.prepare('SELECT id, username, role, created_at FROM users WHERE lower(username) = lower(?)').get(accountName);
        if (!user) throw new ApiError(404, 'Profile not found.');
        return sendJson(response, 200, { profile: await profileForUser(user) });
    }
    if (pathname === '/api/levels' && request.method === 'GET') return sendJson(response, 200, { levels: await publicLevels() });
    if (pathname === '/api/leaderboard' && request.method === 'GET') return sendJson(response, 200, { leaderboard: await publicLeaderboard() });
    if (pathname === '/api/submissions' && request.method === 'GET') return sendJson(response, 200, { submissions: await ownSubmissions((await requireUser(request)).id) });
    if (pathname === '/api/submissions/level' && request.method === 'POST') return submitLevel(request, response);
    if (pathname === '/api/submissions/run' && request.method === 'POST') return submitRun(request, response);
    if (pathname === '/api/admin/submissions' && request.method === 'GET') {
        await requireRole(request, ['moderator', 'admin']);
        return sendJson(response, 200, { submissions: await adminSubmissions(searchParams.get('status') || 'pending') });
    }
    const reviewMatch = pathname.match(/^\/api\/admin\/submissions\/([0-9a-f-]{36})\/review$/i);
    if (reviewMatch && request.method === 'POST') return reviewSubmission(request, response, reviewMatch[1]);
    if (pathname === '/api/admin/users' && request.method === 'GET') {
        await requireRole(request, ['admin']);
        const query = cleanText(searchParams.get('query') || '', 'Search query', { max: 64 });
        const matching = (await db.prepare(`
            SELECT u.id, u.username, u.email, u.role, u.created_at, p.display_name
            FROM users u LEFT JOIN profiles p ON p.user_id = u.id
            WHERE u.username LIKE ? OR u.email LIKE ? OR p.display_name LIKE ?
            ORDER BY u.created_at DESC LIMIT 50
        `).all(`%${query}%`, `%${query}%`, `%${query}%`)).map((user) => ({
            id: user.id, username: user.username, email: user.email, displayName: user.display_name, role: user.role, createdAt: user.created_at,
        }));
        return sendJson(response, 200, { users: matching });
    }
    const userMatch = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/role$/i);
    if (userMatch && request.method === 'PATCH') return updateRole(request, response, userMatch[1]);
    throw new ApiError(404, 'API endpoint not found.');
}

async function withDatabase(callback) {
    const connectionString = String(process.env.DATABASE_URL || '').trim();
    if (!connectionString) {
        throw new ApiError(500, 'Database is not configured. Set DATABASE_URL in Vercel Environment Variables.');
    }

    const client = new Client(connectionString);
    await client.connect();
    const database = new PostgresDatabase(client);
    try {
        return await databaseContext.run(database, async () => {
            if (!databaseInitialized) {
                await migrateAndImportList();
                databaseInitialized = true;
            }
            return callback();
        });
    } finally {
        await client.end();
    }
}

export async function handleRequest(request, response) {
    try {
        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
        if (requestUrl.pathname.startsWith('/api/')) {
            await withDatabase(async () => {
                await handleApi(request, response, requestUrl.pathname, requestUrl.searchParams);
            });
        } else {
            sendStatic(request, response, requestUrl.pathname);
        }
    } catch (error) {
        sendError(response, error);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = createServer(handleRequest);
    server.listen(port, () => {
        console.log(`TaCL is running at http://127.0.0.1:${port}`);
    });
}
