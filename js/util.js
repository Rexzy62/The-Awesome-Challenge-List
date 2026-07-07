const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{6,}$/;

export function getYoutubeIdFromUrl(url) {
    if (!url) {
        return '';
    }

    try {
        const parsedUrl = new URL(String(url));
        const host = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
        let id = '';

        if (host === 'youtu.be') {
            id = pathSegments[0] || '';
        } else if (host === 'youtube.com' || host === 'm.youtube.com') {
            if (parsedUrl.pathname === '/watch') {
                id = parsedUrl.searchParams.get('v') || '';
            } else if (['embed', 'shorts', 'v'].includes(pathSegments[0])) {
                id = pathSegments[1] || '';
            }
        }

        return youtubeVideoIdPattern.test(id) ? id : '';
    } catch {
        return '';
    }
}

export function embed(video) {
    const id = getYoutubeIdFromUrl(video);
    return id ? `https://www.youtube.com/embed/${id}` : '';
}

export function isUrl(value) {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

export function localize(num) {
    return Number(num).toLocaleString(undefined, { minimumFractionDigits: 3 });
}

export function getThumbnailFromId(id) {
    return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

// https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
export function shuffle(array) {
    let currentIndex = array.length, randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex != 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex],
            array[currentIndex],
        ];
    }

    return array;
}
