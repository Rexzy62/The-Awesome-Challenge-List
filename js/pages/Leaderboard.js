import { fetchLeaderboard } from '../content.js';
import { isUrl, localize } from '../util.js';

import Spinner from '../components/Spinner.js';

export default {
    components: {
        Spinner,
    },
    data: () => ({
        leaderboard: [],
        loading: true,
        search: '',
        selectedUser: '',
        err: [],
    }),
    template: `
        <main v-if="loading">
            <Spinner></Spinner>
        </main>
        <main v-else class="page-leaderboard-container">
            <div class="page-leaderboard">
                <div class="error-container">
                    <p class="error" v-if="err.length > 0">
                        Leaderboard may be incorrect, as the following levels could not be loaded: {{ err.join(', ') }}
                    </p>
                </div>
                <div class="board-container">
                    <form class="filters" @submit.prevent>
                        <label>
                            <span class="type-label-md">Search players</span>
                            <input
                                v-model.trim="search"
                                type="search"
                                placeholder="Player name"
                                aria-label="Search leaderboard players"
                            >
                        </label>
                        <p class="type-label-md">{{ filteredLeaderboard.length }} of {{ leaderboard.length }} shown</p>
                    </form>
                    <table class="board" v-if="filteredLeaderboard.length > 0">
                        <tr v-for="ientry in filteredLeaderboard" :key="ientry.user">
                            <td class="rank">
                                <p class="type-label-lg">#{{ rankFor(ientry) }}</p>
                            </td>
                            <td class="total">
                                <p class="type-label-lg">{{ localize(ientry.total) }}</p>
                            </td>
                            <td class="user">
                                <router-link class="type-label-lg" :to="'/players/' + ientry.user">{{ ientry.user }}</router-link>
                            </td>
                        </tr>
                    </table>
                    <p class="no-results" v-else>No players match this search.</p>
                </div>
                <div class="player-container">
                    <div class="player" v-if="entry">
                        <h1>#{{ entryRank }} {{ entry.user }}</h1>
                        <h3>{{ localize(entry.total) }} points</h3>
                        <ul class="summary">
                            <li>
                                <span class="type-title-sm">Verified</span>
                                <p>{{ entry.verified.length }}</p>
                            </li>
                            <li>
                                <span class="type-title-sm">Completed</span>
                                <p>{{ entry.completed.length }}</p>
                            </li>
                            <li>
                                <span class="type-title-sm">Progressed</span>
                                <p>{{ entry.progressed.length }}</p>
                            </li>
                        </ul>
                        <h2 v-if="entry.verified.length > 0">Verified ({{ entry.verified.length}})</h2>
                        <table class="table">
                            <tr v-for="score in entry.verified">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a v-if="isUrl(score.link)" class="type-label-lg" target="_blank" rel="noopener noreferrer" :href="score.link">{{ score.level }}</a>
                                    <span v-else class="type-label-lg">{{ score.level }}</span>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                        <h2 v-if="entry.completed.length > 0">Completed ({{ entry.completed.length }})</h2>
                        <table class="table">
                            <tr v-for="score in entry.completed">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a v-if="isUrl(score.link)" class="type-label-lg" target="_blank" rel="noopener noreferrer" :href="score.link">{{ score.level }}</a>
                                    <span v-else class="type-label-lg">{{ score.level }}</span>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                        <h2 v-if="entry.progressed.length > 0">Progressed ({{entry.progressed.length}})</h2>
                        <table class="table">
                            <tr v-for="score in entry.progressed">
                                <td class="rank">
                                    <p>#{{ score.rank }}</p>
                                </td>
                                <td class="level">
                                    <a v-if="isUrl(score.link)" class="type-label-lg" target="_blank" rel="noopener noreferrer" :href="score.link">{{ score.percent }}% {{ score.level }}</a>
                                    <span v-else class="type-label-lg">{{ score.percent }}% {{ score.level }}</span>
                                </td>
                                <td class="score">
                                    <p>+{{ localize(score.score) }}</p>
                                </td>
                            </tr>
                        </table>
                    </div>
                    <div class="player empty" v-else>
                        <p>No leaderboard entries yet.</p>
                    </div>
                </div>
            </div>
        </main>
    `,
    computed: {
        filteredLeaderboard() {
            const query = this.search.toLowerCase();
            if (!query) {
                return this.leaderboard;
            }

            return this.leaderboard.filter((entry) => (
                entry.user.toLowerCase().includes(query)
            ));
        },
        entry() {
            return this.filteredLeaderboard.find((entry) => entry.user === this.selectedUser)
                || this.filteredLeaderboard[0]
                || null;
        },
        entryRank() {
            const index = this.leaderboard.findIndex((entry) => (
                entry.user === this.entry?.user
            ));
            return index >= 0 ? index + 1 : 0;
        },
    },
    async mounted() {
        const [leaderboard, err] = await fetchLeaderboard();
        this.leaderboard = leaderboard;
        this.selectedUser = leaderboard[0]?.user || '';
        this.err = err;
        // Hide loading spinner
        this.loading = false;
    },
    methods: {
        localize,
        isUrl,
        rankFor(entry) {
            return this.leaderboard.findIndex((item) => item.user === entry.user) + 1;
        },
    },
};
