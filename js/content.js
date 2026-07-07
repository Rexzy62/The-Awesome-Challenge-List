import { round, score } from './score.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

function normalizeLevel(level, path) {
    return {
        ...level,
        path,
        percentToQualify: Number(level.percentToQualify),
        records: Array.isArray(level.records)
            ? level.records
                .map((record) => ({
                    ...record,
                    percent: Number(record.percent),
                    hz: Number(record.hz),
                }))
                .sort((a, b) => b.percent - a.percent)
            : [],
    };
}

function getCanonicalName(map, name) {
    return Object.keys(map).find(
        (user) => user.toLowerCase() === name.toLowerCase(),
    ) || name;
}

async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
    }

    return response.json();
}

export async function fetchList() {
    try {
        const list = await fetchJson(`${dir}/_list.json`);
        if (!Array.isArray(list)) {
            throw new Error("_list.json must contain an array.");
        }

        return await Promise.all(
            list.map(async (path, rank) => {
                try {
                    const level = await fetchJson(`${dir}/${path}.json`);
                    return [normalizeLevel(level, path), null];
                } catch (error) {
                    console.error(
                        `Failed to load level #${rank + 1} ${path}.`,
                        error,
                    );
                    return [null, path];
                }
            }),
        );
    } catch (error) {
        console.error(`Failed to load list.`, error);
        return null;
    }
}

export async function fetchEditors() {
    try {
        return await fetchJson(`${dir}/_editors.json`);
    } catch (error) {
        console.error(`Failed to load editors.`, error);
        return null;
    }
}

export async function fetchLeaderboard() {
    const list = await fetchList();
    if (!list) {
        return [[], ['_list']];
    }

    const scoreMap = {};
    const errs = [];
    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        // Verification
        const verifier = getCanonicalName(scoreMap, level.verifier);
        scoreMap[verifier] ??= {
            verified: [],
            completed: [],
            progressed: [],
        };
        const { verified } = scoreMap[verifier];
        verified.push({
            rank: rank + 1,
            level: level.name,
            score: score(rank + 1, 100, level.percentToQualify),
            link: level.verification,
        });

        // Records
        level.records.forEach((record) => {
            const user = getCanonicalName(scoreMap, record.user);
            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { completed, progressed } = scoreMap[user];
            if (record.percent === 100) {
                completed.push({
                    rank: rank + 1,
                    level: level.name,
                    score: score(rank + 1, 100, level.percentToQualify),
                    link: record.link,
                });
                return;
            }

            progressed.push({
                rank: rank + 1,
                level: level.name,
                percent: record.percent,
                score: score(rank + 1, record.percent, level.percentToQualify),
                link: record.link,
            });
        });
    });

    // Wrap in extra Object containing the user and total score
    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed, progressed } = scores;
        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + cur.score, 0);

        return {
            user,
            total: round(total),
            ...scores,
        };
    });

    // Sort by total score
    return [res.sort((a, b) => b.total - a.total), errs];
}
